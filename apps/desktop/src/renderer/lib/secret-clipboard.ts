const DEFAULT_CLEAR_MS = 30_000;

export interface CopySecretOptions {
  clearAfterMs?: number;
  onCleared?: () => void;
}

export async function copySecretToClipboard(
  value: string,
  options: CopySecretOptions = {}
): Promise<void> {
  const { clearAfterMs = DEFAULT_CLEAR_MS, onCleared } = options;
  await window.electronAPI.clipboard.writeText(value);

  if (clearAfterMs <= 0) return;

  window.setTimeout(async () => {
    try {
      const result = await window.electronAPI.clipboard.readText();
      if (result.success && result.text === value) {
        await window.electronAPI.clipboard.writeText('');
        onCleared?.();
      }
    } catch {
    }
  }, clearAfterMs);
}
