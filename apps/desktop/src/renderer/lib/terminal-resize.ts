import type { FitAddon } from '@xterm/addon-fit';
import type { Terminal } from '@xterm/xterm';
import type { MutableRefObject } from 'react';

export interface PtySizeRefs {
  lastSizeRef: MutableRefObject<{ cols: number; rows: number } | null>;
  lastContainerRef: MutableRefObject<{ width: number; height: number } | null>;
  ptySyncedRef: MutableRefObject<boolean>;
  resizeRafRef: MutableRefObject<number | null>;
  resizeDebounceRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
}

export function clearPtySizeCache(refs: PtySizeRefs): void {
  refs.lastSizeRef.current = null;
  refs.lastContainerRef.current = null;
  refs.ptySyncedRef.current = false;
}

export async function syncPtySize(
  sessionId: string,
  container: HTMLDivElement | null,
  terminal: Terminal | null,
  fitAddon: FitAddon | null,
  refs: PtySizeRefs
): Promise<boolean> {
  if (!container || !terminal || !fitAddon) return false;

  try {
    const { width, height } = container.getBoundingClientRect();
    const w = Math.round(width);
    const h = Math.round(height);
    if (w <= 0 || h <= 0) return false;

    const prevContainer = refs.lastContainerRef.current;
    const containerUnchanged = prevContainer && prevContainer.width === w && prevContainer.height === h;

    if (containerUnchanged && refs.ptySyncedRef.current) {
      return true;
    }

    refs.lastContainerRef.current = { width: w, height: h };
    fitAddon.fit();
    const { cols, rows } = terminal;
    if (!cols || !rows) return false;

    const last = refs.lastSizeRef.current;
    if (containerUnchanged && last && last.cols === cols && last.rows === rows && refs.ptySyncedRef.current) {
      return true;
    }

    const result = await window.electronAPI.ssh.resize(sessionId, { cols, rows });
    const synced = result.applied || result.queued;

    if (synced) {
      refs.lastSizeRef.current = { cols, rows };
      refs.ptySyncedRef.current = true;
      terminal.refresh(0, terminal.rows - 1);
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

export function schedulePtyResize(
  sessionId: string,
  containerRef: MutableRefObject<HTMLDivElement | null>,
  terminalRef: MutableRefObject<Terminal | null>,
  fitAddonRef: MutableRefObject<FitAddon | null>,
  refs: PtySizeRefs,
  debounceMs = 150
): void {
  if (refs.resizeDebounceRef.current !== null) {
    clearTimeout(refs.resizeDebounceRef.current);
  }
  refs.resizeDebounceRef.current = setTimeout(() => {
    refs.resizeDebounceRef.current = null;
    void syncPtySize(
      sessionId,
      containerRef.current,
      terminalRef.current,
      fitAddonRef.current,
      refs
    );
  }, debounceMs);
}

export function handlePtyResize(
  sessionId: string,
  containerRef: MutableRefObject<HTMLDivElement | null>,
  terminalRef: MutableRefObject<Terminal | null>,
  fitAddonRef: MutableRefObject<FitAddon | null>,
  refs: PtySizeRefs
): void {
  if (refs.resizeRafRef.current !== null) cancelAnimationFrame(refs.resizeRafRef.current);
  refs.resizeRafRef.current = requestAnimationFrame(() => {
    refs.resizeRafRef.current = null;
    schedulePtyResize(sessionId, containerRef, terminalRef, fitAddonRef, refs);
  });
}

export function disposePtyResize(refs: PtySizeRefs): void {
  if (refs.resizeRafRef.current !== null) {
    cancelAnimationFrame(refs.resizeRafRef.current);
    refs.resizeRafRef.current = null;
  }
  if (refs.resizeDebounceRef.current !== null) {
    clearTimeout(refs.resizeDebounceRef.current);
    refs.resizeDebounceRef.current = null;
  }
  clearPtySizeCache(refs);
}
