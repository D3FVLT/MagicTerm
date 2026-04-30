/**
 * Clipboard helper for sensitive values (passwords, private keys, snippet
 * secrets). Writes the value, then schedules a wipe so a value the user
 * pastes once is not still sitting on the system pasteboard 30 minutes later
 * waiting for `pbpaste`/another app's clipboard hijacking.
 *
 * The wipe only fires if the clipboard content has not changed since we
 * wrote it — that way we do not blow away whatever the user copied in the
 * meantime (a URL, a piece of code, etc.).
 */

const DEFAULT_CLEAR_MS = 30_000;

export interface CopySecretOptions {
  clearAfterMs?: number;
  onCleared?: () => void;
}

export function copySecretToClipboard(value: string, options: CopySecretOptions = {}): void {
  const { clearAfterMs = DEFAULT_CLEAR_MS, onCleared } = options;
  window.electronAPI.clipboard.writeText(value);

  if (clearAfterMs <= 0) return;

  window.setTimeout(() => {
    try {
      const current = window.electronAPI.clipboard.readText();
      if (current === value) {
        window.electronAPI.clipboard.writeText('');
        onCleared?.();
      }
    } catch {
      // Clipboard read may be unavailable on some platforms; ignore.
    }
  }, clearAfterMs);
}
