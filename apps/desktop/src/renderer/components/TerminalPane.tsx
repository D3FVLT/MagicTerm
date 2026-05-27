import { useEffect, useRef, useCallback, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { SnippetsPanel } from './SnippetsPanel';
import { KeyboardShortcutsModal } from './KeyboardShortcutsModal';
import { TERMINAL_THEMES, DEFAULT_TERMINAL_SETTINGS, type TerminalSettings } from '../lib/terminal-themes';
import { useTerminal } from '../contexts/TerminalContext';
import '@xterm/xterm/css/xterm.css';

interface TerminalPaneProps {
  sessionId: string;
  isFocused: boolean;
  tabId: string;
}

export function TerminalPane({ sessionId, isFocused, tabId }: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSnippets, setShowSnippets] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'reconnecting'>('connected');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [termSettings, setTermSettings] = useState<TerminalSettings>(DEFAULT_TERMINAL_SETTINGS);
  const settingsLoadedRef = useRef(false);
  const [showContextMenu, setShowContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const lastSizeRef = useRef<{ cols: number; rows: number } | null>(null);
  const resizeRafRef = useRef<number | null>(null);

  const { reconnect, splitPane, closePane, setFocusedPane, getSession, tabs } = useTerminal();
  const session = getSession(sessionId);
  const tab = tabs.find((t) => t.rootSessionId === tabId);
  const hasMultiplePanes = tab && tab.splitTree.type === 'split';

  const syncPtySize = useCallback(() => {
    if (!fitAddonRef.current || !terminalRef.current || !containerRef.current) return;
    try {
      fitAddonRef.current.fit();
      const { cols, rows } = terminalRef.current;
      if (!cols || !rows) return;
      const last = lastSizeRef.current;
      if (last && last.cols === cols && last.rows === rows) return;
      lastSizeRef.current = { cols, rows };
      window.electronAPI.ssh.resize(sessionId, { cols, rows });
    } catch {
      // Terminal not ready yet
    }
  }, [sessionId]);

  const handleResize = useCallback(() => {
    if (resizeRafRef.current !== null) cancelAnimationFrame(resizeRafRef.current);
    resizeRafRef.current = requestAnimationFrame(() => {
      resizeRafRef.current = null;
      syncPtySize();
    });
  }, [syncPtySize]);

  const handleSearch = useCallback((direction: 'next' | 'prev') => {
    if (!searchAddonRef.current || !searchQuery) return;
    if (direction === 'next') {
      searchAddonRef.current.findNext(searchQuery, { caseSensitive: false });
    } else {
      searchAddonRef.current.findPrevious(searchQuery, { caseSensitive: false });
    }
  }, [searchQuery]);

  const handlePasteToTerminal = useCallback((text: string) => {
    if (terminalRef.current) {
      window.electronAPI.ssh.sendData(sessionId, text);
    }
  }, [sessionId]);

  useEffect(() => {
    const loadSettings = () => {
      window.electronAPI.terminalSettings.get().then((result) => {
        if (result.success && result.settings) {
          setTermSettings({ ...DEFAULT_TERMINAL_SETTINGS, ...result.settings as Partial<TerminalSettings> });
        }
        settingsLoadedRef.current = true;
      });
    };
    loadSettings();
    window.addEventListener('terminal-settings-changed', loadSettings);
    return () => window.removeEventListener('terminal-settings-changed', loadSettings);
  }, []);

  useEffect(() => {
    if (terminalRef.current && settingsLoadedRef.current) {
      const theme = TERMINAL_THEMES[termSettings.themeId] || TERMINAL_THEMES['tokyo-night'];
      terminalRef.current.options.theme = theme;
      terminalRef.current.options.fontFamily = termSettings.fontFamily;
      terminalRef.current.options.fontSize = termSettings.fontSize;
      terminalRef.current.options.cursorStyle = termSettings.cursorStyle;
      terminalRef.current.options.cursorBlink = termSettings.cursorBlink;
      terminalRef.current.options.scrollback = termSettings.scrollback;
      terminalRef.current.options.lineHeight = termSettings.lineHeight;
      setTimeout(() => syncPtySize(), 50);
    }
  }, [termSettings, syncPtySize]);

  useEffect(() => {
    if (isFocused && terminalRef.current) {
      const timers = [
        setTimeout(() => {
          syncPtySize();
          terminalRef.current?.focus();
        }, 20),
        setTimeout(() => syncPtySize(), 120),
        setTimeout(() => syncPtySize(), 300),
      ];
      return () => timers.forEach((t) => clearTimeout(t));
    }
  }, [isFocused, syncPtySize]);

  useEffect(() => {
    const onSplitResize = () => {
      setTimeout(() => syncPtySize(), 50);
    };
    window.addEventListener('split-resize', onSplitResize);
    return () => window.removeEventListener('split-resize', onSplitResize);
  }, [syncPtySize]);

  useEffect(() => {
    if (!containerRef.current) return;

    const theme = TERMINAL_THEMES[termSettings.themeId] || TERMINAL_THEMES['tokyo-night'];
    const terminal = new Terminal({
      cursorBlink: termSettings.cursorBlink,
      cursorStyle: termSettings.cursorStyle,
      cursorWidth: 2,
      fontSize: termSettings.fontSize,
      fontFamily: termSettings.fontFamily,
      fontWeight: '400',
      fontWeightBold: '600',
      letterSpacing: 0,
      lineHeight: termSettings.lineHeight,
      theme,
      allowTransparency: false,
      scrollback: termSettings.scrollback,
      smoothScrollDuration: 100,
      macOptionIsMeta: true,
      macOptionClickForcesSelection: true,
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon();
    const webLinksAddon = new WebLinksAddon((_, uri) => {
      window.open(uri, '_blank');
    });
    const unicode11Addon = new Unicode11Addon();

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(searchAddon);
    terminal.loadAddon(webLinksAddon);
    terminal.loadAddon(unicode11Addon);
    terminal.unicode.activeVersion = '11';

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    searchAddonRef.current = searchAddon;

    terminal.open(containerRef.current);

    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => webglAddon.dispose());
      terminal.loadAddon(webglAddon);
    } catch {
      // WebGL not available
    }

    syncPtySize();
    requestAnimationFrame(() => syncPtySize());


    const codeToLatin = (code: string): string | null => {
      if (code.length === 4 && code.startsWith('Key')) {
        return code.slice(3).toLowerCase();
      }
      return null;
    };

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
        window.electronAPI.clipboard
          .readText()
          .then((result) => {
            if (result.success && result.text) {
              void window.electronAPI.ssh.sendData(sessionId, result.text);
            }
          })
          .catch(() => {
          });
        ev.preventDefault();
        return false;
      }

      if (hasCtrl && physical === 'f') {
        setShowSearch((prev) => {
          if (!prev) setTimeout(() => searchInputRef.current?.focus(), 50);
          return !prev;
        });
        ev.preventDefault();
        return false;
      }

      if (
        ev.ctrlKey &&
        !ev.metaKey &&
        !ev.altKey &&
        !ev.shiftKey &&
        physical &&
        ev.key.length === 1 &&
        ev.key.toLowerCase() !== physical
      ) {
        const code = physical.charCodeAt(0) - 96;
        if (code >= 1 && code <= 26) {
          window.electronAPI.ssh.sendData(sessionId, String.fromCharCode(code));
          ev.preventDefault();
          return false;
        }
      }

      return true;
    });

    terminal.onData((data) => {
      window.electronAPI.ssh.sendData(sessionId, data);
    });

    const removeDataListener = window.electronAPI.ssh.onData(
      (incomingSessionId, data) => {
        if (incomingSessionId === sessionId) {
          terminal.write(data);
        }
      }
    );

    const removeStatusListener = window.electronAPI.ssh.onStatus(
      (incomingSessionId, status, error) => {
        if (incomingSessionId === sessionId) {
          if (status === 'disconnected') {
            terminal.write('\r\n\x1b[38;5;221m⚡ Connection closed.\x1b[0m\r\n');
            setConnectionStatus('disconnected');
          } else if (status === 'error') {
            terminal.write(`\r\n\x1b[38;5;203m✖ Error: ${error}\x1b[0m\r\n`);
            setConnectionStatus('disconnected');
          } else if (status === 'connected') {
            setConnectionStatus('connected');
          }
        }
      }
    );

    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => handleResize());
    });
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    terminal.focus();

    return () => {
      removeDataListener();
      removeStatusListener();
      resizeObserver.disconnect();
      if (resizeRafRef.current !== null) {
        cancelAnimationFrame(resizeRafRef.current);
        resizeRafRef.current = null;
      }
      lastSizeRef.current = null;
      terminal.dispose();
    };
  }, [sessionId, handleResize]);

  const activeTheme = TERMINAL_THEMES[termSettings.themeId] || TERMINAL_THEMES['tokyo-night'];

  return (
    <div
      className={`flex h-full w-full flex-col ${isFocused ? 'ring-1 ring-[var(--accent)]/30 ring-inset' : ''}`}
      style={{ backgroundColor: activeTheme.background }}
      onClick={() => {
        setFocusedPane(tabId, sessionId);
        terminalRef.current?.focus();
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        setShowContextMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      {/* Pane header */}
      <div className="flex h-7 flex-shrink-0 items-center justify-between border-b border-[var(--border)] bg-[var(--surface-1)] px-2">
        <div className="flex items-center gap-1.5">
          {connectionStatus === 'connected' && (
            <div className="h-2 w-2 rounded-full bg-green-500" />
          )}
          {connectionStatus === 'reconnecting' && (
            <div className="h-2 w-2 rounded-full bg-yellow-500 animate-pulse" />
          )}
          {connectionStatus === 'disconnected' && (
            <div className="h-2 w-2 rounded-full bg-red-500" />
          )}
          <span className="text-xs text-[var(--fg-subtle)] truncate max-w-[150px]">
            {session?.serverId ? `pane` : 'terminal'}
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          {/* Snippets toggle */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowSnippets((prev) => !prev);
            }}
            className={`rounded p-1 transition-colors ${
              showSnippets
                ? 'bg-[var(--accent-hover)] text-white'
                : 'text-[var(--fg-subtle)] hover:bg-[var(--border)] hover:text-[var(--fg)]'
            }`}
            title="Snippets"
          >
            <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
            </svg>
          </button>
          {/* Keyboard shortcuts help */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowShortcuts(true);
            }}
            className="rounded p-1 text-[var(--fg-subtle)] transition-colors hover:bg-[var(--border)] hover:text-[var(--fg)]"
            title="Keyboard shortcuts"
          >
            <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M8 14h8M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
            </svg>
          </button>
          {hasMultiplePanes && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                closePane(sessionId);
              }}
              className="rounded p-1 text-[var(--fg-subtle)] hover:bg-[var(--border)] hover:text-red-400"
              title="Close pane"
            >
              <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Terminal content */}
      <div className="relative flex-1">
        <div
          ref={containerRef}
          className="terminal-container absolute inset-0"
          style={{ backgroundColor: activeTheme.background }}
        />

        {/* Snippets panel */}
        {showSnippets && (
          <div className="absolute right-2 top-2 z-30">
            <SnippetsPanel
              isOpen={showSnippets}
              onClose={() => setShowSnippets(false)}
              onPaste={handlePasteToTerminal}
            />
          </div>
        )}

        {/* Reconnect toast */}
        {connectionStatus === 'disconnected' && (
          <div className="absolute left-1/2 top-4 z-20 -translate-x-1/2 flex items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-1)]/95 px-4 py-2 shadow-lg backdrop-blur-sm">
            <div className="h-2 w-2 rounded-full bg-red-500" />
            <span className="text-xs text-[var(--fg)]">Disconnected</span>
            <button
              onClick={async (e) => {
                e.stopPropagation();
                setConnectionStatus('reconnecting');
                try {
                  await reconnect(sessionId);
                  setConnectionStatus('connected');
                  terminalRef.current?.write('\r\n\x1b[38;5;114m⚡ Reconnected.\x1b[0m\r\n');
                } catch {
                  setConnectionStatus('disconnected');
                  terminalRef.current?.write('\r\n\x1b[38;5;203m✖ Reconnect failed.\x1b[0m\r\n');
                }
              }}
              className="rounded bg-[var(--accent)] px-2 py-0.5 text-xs font-medium text-white hover:bg-[var(--accent-hover)]"
            >
              Reconnect
            </button>
          </div>
        )}
        {connectionStatus === 'reconnecting' && (
          <div className="absolute left-1/2 top-4 z-20 -translate-x-1/2 flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-1)]/95 px-4 py-2 shadow-lg backdrop-blur-sm">
            <div className="h-3 w-3 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
            <span className="text-xs text-[var(--fg)]">Reconnecting...</span>
          </div>
        )}

        {/* Search */}
        {showSearch && (
          <div className="absolute bottom-2 right-2 z-10 flex w-64 items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface-1)]/95 p-1.5 shadow-lg backdrop-blur-sm">
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                if (e.target.value && searchAddonRef.current) {
                  searchAddonRef.current.findNext(e.target.value, { caseSensitive: false });
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSearch(e.shiftKey ? 'prev' : 'next');
                if (e.key === 'Escape') {
                  setShowSearch(false);
                  setSearchQuery('');
                  terminalRef.current?.focus();
                }
              }}
              placeholder="Search..."
              className="flex-1 rounded bg-[var(--border)] px-2 py-1 text-xs text-[var(--fg)] placeholder-[var(--fg-subtle)] outline-none"
            />
            <button
              onClick={() => handleSearch('prev')}
              className="rounded p-1 text-[var(--fg-subtle)] hover:text-[var(--fg)]"
            >
              <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
              </svg>
            </button>
            <button
              onClick={() => handleSearch('next')}
              className="rounded p-1 text-[var(--fg-subtle)] hover:text-[var(--fg)]"
            >
              <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            <button
              onClick={() => {
                setShowSearch(false);
                setSearchQuery('');
                terminalRef.current?.focus();
              }}
              className="rounded p-1 text-[var(--fg-subtle)] hover:text-[var(--fg)]"
            >
              <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}
      </div>

      {/* Context menu */}
      {showContextMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowContextMenu(null)} />
          <div
            className="fixed z-50 min-w-[160px] rounded-lg border border-[var(--border)] bg-[var(--surface-1)] py-1 shadow-xl"
            style={{ left: showContextMenu.x, top: showContextMenu.y }}
          >
            <button
              onClick={() => {
                setShowContextMenu(null);
                splitPane(sessionId, 'horizontal');
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-[var(--fg)] hover:bg-[var(--border)]"
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m0-8h8m-8 0H4" />
              </svg>
              Split Right
              <span className="ml-auto text-[var(--fg-subtle)]">⌘D</span>
            </button>
            <button
              onClick={() => {
                setShowContextMenu(null);
                splitPane(sessionId, 'vertical');
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-[var(--fg)] hover:bg-[var(--border)]"
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m0-8h8m-8 0H4" />
              </svg>
              Split Down
              <span className="ml-auto text-[var(--fg-subtle)]">⇧⌘D</span>
            </button>
            <div className="my-1 border-t border-[var(--border)]" />
            <button
              onClick={() => {
                setShowContextMenu(null);
                setShowShortcuts(true);
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-[var(--fg)] hover:bg-[var(--border)]"
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M8 14h8M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
              </svg>
              Keyboard shortcuts
            </button>
            {hasMultiplePanes && (
              <>
                <div className="my-1 border-t border-[var(--border)]" />
                <button
                  onClick={() => {
                    setShowContextMenu(null);
                    closePane(sessionId);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-red-400 hover:bg-[var(--border)]"
                >
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  Close Pane
                </button>
              </>
            )}
          </div>
        </>
      )}

      <KeyboardShortcutsModal
        isOpen={showShortcuts}
        onClose={() => setShowShortcuts(false)}
      />
    </div>
  );
}
