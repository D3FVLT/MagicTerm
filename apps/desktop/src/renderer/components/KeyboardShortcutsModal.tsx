import { useMemo } from 'react';
import { Modal } from './ui/Modal';

interface KeyboardShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface Shortcut {
  /** Either a literal token like "Tab", or "Mod" / "Mod+Shift" which renders
   *  as ⌘ on macOS and Ctrl elsewhere. */
  keys: string[];
  description: string;
}

interface ShortcutGroup {
  title: string;
  hint?: string;
  items: Shortcut[];
}

const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);
const MOD_LABEL = isMac ? '⌘' : 'Ctrl';
const ALT_LABEL = isMac ? '⌥' : 'Alt';

function renderKey(token: string): string {
  return token
    .split('+')
    .map((part) => {
      if (part === 'Mod') return MOD_LABEL;
      if (part === 'Alt') return ALT_LABEL;
      return part;
    })
    .join(' + ');
}

const GROUPS: ShortcutGroup[] = [
  {
    title: 'MagicTerm',
    hint: 'Application-level shortcuts',
    items: [
      { keys: ['Mod+D'], description: 'Split pane horizontally' },
      { keys: ['Mod+Shift+D'], description: 'Split pane vertically' },
      { keys: ['Mod+W'], description: 'Close focused pane / tab' },
      { keys: ['Mod+F'], description: 'Search in terminal buffer' },
      { keys: ['Esc'], description: 'Close search bar' },
    ],
  },
  {
    title: 'Clipboard',
    hint: 'Copy/paste',
    items: isMac
      ? [
          { keys: ['Mod+C'], description: 'Copy selection (when something is selected)' },
          { keys: ['Mod+V'], description: 'Paste' },
          { keys: ['Mod+Shift+C'], description: 'Copy selection (force)' },
          { keys: ['Mod+Shift+V'], description: 'Paste (alternative)' },
        ]
      : [
          { keys: ['Ctrl+Shift+C'], description: 'Copy selection' },
          { keys: ['Ctrl+Shift+V'], description: 'Paste' },
          {
            keys: ['Ctrl+C'],
            description: 'Copy when text is selected, otherwise sends SIGINT to the shell',
          },
        ],
  },
  {
    title: 'Shell — Readline',
    hint: 'Sent to the remote shell.',
    items: [
      { keys: ['Ctrl+R'], description: 'Reverse history search (incremental)' },
      { keys: ['Ctrl+L'], description: 'Clear screen' },
      { keys: ['Ctrl+A'], description: 'Move cursor to beginning of line' },
      { keys: ['Ctrl+E'], description: 'Move cursor to end of line' },
      { keys: ['Ctrl+U'], description: 'Delete from cursor to beginning of line' },
      { keys: ['Ctrl+K'], description: 'Delete from cursor to end of line' },
      { keys: ['Ctrl+W'], description: 'Delete word before cursor' },
      { keys: ['Ctrl+Y'], description: 'Paste last killed text (yank)' },
      { keys: ['Alt+B'], description: 'Move cursor one word back' },
      { keys: ['Alt+F'], description: 'Move cursor one word forward' },
      { keys: ['Tab'], description: 'Autocomplete' },
      { keys: ['↑', '↓'], description: 'Browse command history' },
    ],
  },
  {
    title: 'Shell — Process control',
    items: [
      { keys: ['Ctrl+C'], description: 'Interrupt current process (SIGINT)' },
      { keys: ['Ctrl+D'], description: 'End of file / log out of shell' },
      { keys: ['Ctrl+Z'], description: 'Suspend current process (resume with `fg`)' },
    ],
  },
];

export function KeyboardShortcutsModal({ isOpen, onClose }: KeyboardShortcutsModalProps) {
  const groups = useMemo(() => GROUPS, []);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Keyboard shortcuts">
      <div className="space-y-6">
        {groups.map((group) => (
          <section key={group.title}>
            <header className="mb-2">
              <h3 className="text-sm font-semibold text-fg">{group.title}</h3>
              {group.hint && (
                <p className="mt-0.5 text-xs text-fg-subtle">{group.hint}</p>
              )}
            </header>
            <ul className="divide-y divide-edge/60 overflow-hidden rounded-lg border border-edge bg-surface-2/40">
              {group.items.map((item, idx) => (
                <li
                  key={idx}
                  className="flex items-center justify-between gap-4 px-3 py-2.5 text-sm"
                >
                  <span className="text-fg-muted">{item.description}</span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    {item.keys.map((token, ki) => (
                      <kbd
                        key={ki}
                        className="rounded-md border border-edge bg-surface-3 px-2 py-1 font-mono text-xs font-medium text-fg shadow-sm"
                      >
                        {renderKey(token)}
                      </kbd>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}

        <p className="text-xs text-fg-subtle">
          Keyboard shortcut not working? It might be intercepted by your OS or a global hotkey.
          Most readline shortcuts (Ctrl+R, Ctrl+L, Ctrl+A, …) are sent verbatim to the remote
          shell — try them inside <code className="rounded bg-surface-3 px-1 text-fg">bash</code>{' '}
          or <code className="rounded bg-surface-3 px-1 text-fg">zsh</code>.
        </p>
      </div>
    </Modal>
  );
}
