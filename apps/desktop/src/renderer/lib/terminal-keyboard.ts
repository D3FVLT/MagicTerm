import type { Terminal } from '@xterm/xterm';

function codeToLatin(code: string): string | null {
  if (code.length === 4 && code.startsWith('Key')) {
    return code.slice(3).toLowerCase();
  }
  return null;
}

export interface TerminalKeyHandlerOptions {
  sessionId: string;
  terminal: Terminal;
  onToggleSearch?: () => void;
}

/**
 * Clipboard/search shortcuts + reliable Ctrl+letter control bytes.
 * xterm.js derives C0 bytes from ev.key, which breaks on non-Latin layouts
 * and is flaky on macOS (Ctrl+R etc.). We always map via ev.code instead.
 */
export function attachTerminalKeyHandler(options: TerminalKeyHandlerOptions): void {
  const { sessionId, terminal, onToggleSearch } = options;

  terminal.attachCustomKeyEventHandler((ev) => {
    if (ev.type !== 'keydown') return true;

    const physical = codeToLatin(ev.code);
    const hasCtrl = ev.ctrlKey || ev.metaKey;
    const hasSelection = terminal.hasSelection();

    if (hasCtrl && ev.shiftKey && physical === 'c') {
      if (hasSelection) {
        void window.electronAPI.clipboard.writeText(terminal.getSelection());
      }
      ev.preventDefault();
      return false;
    }

    if (hasCtrl && !ev.shiftKey && physical === 'c' && hasSelection) {
      void window.electronAPI.clipboard.writeText(terminal.getSelection());
      ev.preventDefault();
      return false;
    }

    if (hasCtrl && ev.shiftKey && physical === 'v') {
      void window.electronAPI.clipboard
        .readText()
        .then((result) => {
          if (result.success && result.text) {
            void window.electronAPI.ssh.sendData(sessionId, result.text);
          }
        })
        .catch(() => {});
      ev.preventDefault();
      return false;
    }

    if (hasCtrl && physical === 'f' && onToggleSearch) {
      onToggleSearch();
      ev.preventDefault();
      return false;
    }

    if (
      ev.ctrlKey &&
      !ev.metaKey &&
      !ev.altKey &&
      !ev.shiftKey &&
      physical &&
      physical >= 'a' &&
      physical <= 'z'
    ) {
      const byte = physical.charCodeAt(0) - 96;
      void window.electronAPI.ssh.sendData(sessionId, String.fromCharCode(byte));
      ev.preventDefault();
      return false;
    }

    return true;
  });
}
