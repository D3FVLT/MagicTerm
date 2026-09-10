import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * A single tooltip layer for the whole app, driven by markup instead of
 * wrapper components: put `data-tooltip` on any element and it gets a tooltip.
 *
 *   <button aria-label="Refresh" data-tooltip="">      // reuses the label
 *   <p data-tooltip={server.comment}>                  // explicit text
 *
 * The empty string means "fall back to aria-label", which keeps the text in one
 * place on icon-only buttons. A bare `data-tooltip` would render as the string
 * "true", so it has to be written as `data-tooltip=""`.
 *
 * Rendered in a portal with fixed positioning so it survives the things that
 * break inline tooltips: scroll containers, `overflow: hidden`, and the
 * stacking contexts our card animations create.
 */

const SHOW_DELAY_MS = 300;
/** Distance between the trigger and the bubble. */
const GAP = 8;
/** Smallest allowed distance from the window edge. */
const MARGIN = 8;

interface ActiveTooltip {
  text: string;
  rect: DOMRect;
}

function resolveText(el: Element): string | null {
  const explicit = el.getAttribute('data-tooltip')?.trim();
  if (explicit) return explicit;
  return el.getAttribute('aria-label')?.trim() || null;
}

export function TooltipLayer() {
  const [active, setActive] = useState<ActiveTooltip | null>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<Element | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    const cancelPending = () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const hide = () => {
      cancelPending();
      triggerRef.current = null;
      setActive(null);
      setPosition(null);
    };

    const show = (el: Element, immediate: boolean) => {
      if (el === triggerRef.current) return;
      cancelPending();
      triggerRef.current = el;
      setActive(null);
      setPosition(null);

      const reveal = () => {
        // The element can be unmounted or relabelled during the delay.
        if (triggerRef.current !== el || !el.isConnected) return;
        const text = resolveText(el);
        if (!text) return;
        setActive({ text, rect: el.getBoundingClientRect() });
      };

      if (immediate) reveal();
      else timerRef.current = window.setTimeout(reveal, SHOW_DELAY_MS);
    };

    const handlePointerOver = (event: PointerEvent) => {
      const target = event.target as Element | null;
      const el = target?.closest?.('[data-tooltip]') ?? null;
      if (el) show(el, false);
      else if (triggerRef.current) hide();
    };

    const handleFocusIn = (event: FocusEvent) => {
      const el = (event.target as Element | null)?.closest?.('[data-tooltip]') ?? null;
      // Only for keyboard navigation — otherwise the tooltip pops back up
      // right after you click the button you were already hovering.
      if (el && el.matches(':focus-visible')) show(el, true);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hide();
    };

    document.addEventListener('pointerover', handlePointerOver);
    document.addEventListener('pointerdown', hide);
    document.addEventListener('focusin', handleFocusIn);
    document.addEventListener('focusout', hide);
    document.addEventListener('keydown', handleKeyDown);
    // Capture, because most of our scrolling happens in nested containers
    // whose scroll events never reach the document.
    document.addEventListener('scroll', hide, true);
    window.addEventListener('blur', hide);

    return () => {
      cancelPending();
      document.removeEventListener('pointerover', handlePointerOver);
      document.removeEventListener('pointerdown', hide);
      document.removeEventListener('focusin', handleFocusIn);
      document.removeEventListener('focusout', hide);
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('scroll', hide, true);
      window.removeEventListener('blur', hide);
    };
  }, []);

  // Measure first, then place: the bubble wraps, so its size isn't knowable
  // until it has rendered.
  useLayoutEffect(() => {
    if (!active || !bubbleRef.current) return;
    const bubble = bubbleRef.current.getBoundingClientRect();
    const { rect } = active;

    let top = rect.top - bubble.height - GAP;
    if (top < MARGIN) top = rect.bottom + GAP;

    const left = Math.min(
      Math.max(rect.left + rect.width / 2 - bubble.width / 2, MARGIN),
      Math.max(window.innerWidth - bubble.width - MARGIN, MARGIN)
    );

    setPosition({ top, left });
  }, [active]);

  if (!active) return null;

  return createPortal(
    <div
      ref={bubbleRef}
      role="tooltip"
      style={{ top: position?.top ?? 0, left: position?.left ?? 0 }}
      className={`pointer-events-none fixed z-[200] max-w-xs whitespace-pre-wrap break-words rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1.5 text-xs leading-snug text-[var(--fg-muted)] shadow-lg transition-opacity duration-100 ${
        position ? 'opacity-100' : 'opacity-0'
      }`}
    >
      {active.text}
    </div>,
    document.body
  );
}
