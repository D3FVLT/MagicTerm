import { useState, useEffect, useCallback } from 'react';
import { WEBSITE_URL, GITHUB_URL, DONATE_URL } from '../lib/links';
import { DEFAULT_TERMINAL_SETTINGS } from '../lib/terminal-themes';

/**
 * Sits at the very bottom of the Vaults page: you only meet it once you've
 * scrolled past your servers, so it never interrupts anything. Dismissing it is
 * permanent — the toggle in Settings › General is the only way back.
 */
export function SupportCard() {
  const [copied, setCopied] = useState(false);
  // null while we haven't read the preference yet, so the card can't flash in
  // for someone who has already dismissed it.
  const [visible, setVisible] = useState<boolean | null>(null);

  const readVisibility = useCallback(async () => {
    try {
      const result = await window.electronAPI.terminalSettings.get();
      const stored = (result.settings as { showSupportCard?: unknown } | null)?.showSupportCard;
      setVisible(typeof stored === 'boolean' ? stored : DEFAULT_TERMINAL_SETTINGS.showSupportCard);
    } catch {
      setVisible(DEFAULT_TERMINAL_SETTINGS.showSupportCard);
    }
  }, []);

  useEffect(() => {
    void readVisibility();
    // Settings fires this after saving, so re-enabling the card takes effect
    // without a restart.
    window.addEventListener('terminal-settings-changed', readVisibility);
    return () => window.removeEventListener('terminal-settings-changed', readVisibility);
  }, [readVisibility]);

  const handleDismiss = async () => {
    setVisible(false);
    try {
      const current = await window.electronAPI.terminalSettings.get();
      const base = current.success && current.settings ? current.settings : {};
      await window.electronAPI.terminalSettings.set({ ...base, showSupportCard: false });
    } catch {
      // Worst case it comes back next launch; not worth an error state.
    }
  };

  const handleShare = async () => {
    try {
      await window.electronAPI.clipboard.writeText(WEBSITE_URL);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Copying a public URL isn't worth an error state.
    }
  };

  if (!visible) return null;

  return (
    <div className="relative mt-12 rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-5">
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Hide support card"
        data-tooltip="Hide this — you can bring it back in Settings › General"
        className="absolute right-3 top-3 rounded p-1 text-[var(--fg-subtle)] transition-colors hover:bg-[var(--border)] hover:text-[var(--fg)]"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      <div className="flex items-start gap-3">
        <svg className="mt-0.5 h-5 w-5 flex-shrink-0 text-[var(--accent)]" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
        </svg>

        <div className="min-w-0 flex-1 pr-6">
          <h2 className="text-sm font-medium text-[var(--fg)]">
            Magic Term is made by one person — me
          </h2>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-[var(--fg-muted)]">
            It's free and open source, and I'd love to keep making it better. But it's
            just me, and that takes time and a bit of money. If Magic Term is useful to
            you, any of these genuinely helps — a star on GitHub, telling someone who'd
            like it, or a small donation. Either way, thanks for using it.
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <a
              href={DONATE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-[var(--accent-fg)] transition-opacity hover:opacity-90"
            >
              <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
              </svg>
              Donate
            </a>

            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--fg)] transition-colors hover:border-[var(--accent)]/50 hover:text-[var(--accent)]"
            >
              <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
              </svg>
              Star on GitHub
            </a>

            <button
              type="button"
              onClick={handleShare}
              className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--fg)] transition-colors hover:border-[var(--accent)]/50 hover:text-[var(--accent)]"
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 010 5.656l-3 3a4 4 0 01-5.656-5.656l1.5-1.5m4.5-4.5l1.5-1.5a4 4 0 115.656 5.656l-3 3a4 4 0 01-5.656 0" />
              </svg>
              {copied ? 'Link copied!' : 'Share link'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
