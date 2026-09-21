import { useState, useEffect, useCallback } from 'react';
import { WEBSITE_URL, GITHUB_URL, DONATE_URL } from '../lib/links';
import { DEFAULT_TERMINAL_SETTINGS } from '../lib/terminal-themes';

/**
 * Sits at the very bottom of the Vaults page: you only meet it once you've
 * scrolled past your servers, so it never interrupts anything. Dismissing it is
 * permanent. The toggle in Settings, General, is the only way back.
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
    <div className="mt-6 border-t border-edge py-3">
      <div className="flex items-start gap-3">
        <p className="min-w-0 flex-1 text-[13px] leading-5 text-fg-subtle">
          Magic Term is free and made by one person. A star, a share, or a small donation helps.
        </p>
        <button
          type="button"
          onClick={() => { void handleDismiss(); }}
          aria-label="Hide support"
          data-tooltip="Hide. Turn it back on in Settings, General."
          className="shrink-0 rounded p-1 text-fg-subtle hover:bg-surface-2 hover:text-fg"
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className="mt-2 flex items-center gap-4 text-[13px]">
        <a
          href={DONATE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-fg-subtle hover:text-fg hover:underline"
        >
          Donate
        </a>
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-fg-subtle hover:text-fg hover:underline"
        >
          GitHub
        </a>
        <button
          type="button"
          onClick={() => { void handleShare(); }}
          className="text-fg-subtle hover:text-fg hover:underline"
        >
          {copied ? 'Copied' : 'Share'}
        </button>
      </div>
    </div>
  );
}
