import { useEffect, useRef, useCallback, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { SnippetsPanel } from './SnippetsPanel';
import { KeyboardShortcutsModal } from './KeyboardShortcutsModal';
import { ConnectionOverlay } from './ConnectionOverlay';
import { TERMINAL_THEMES, DEFAULT_TERMINAL_SETTINGS, type TerminalSettings } from '../lib/terminal-themes';
import { useTerminal } from '../contexts/TerminalContext';
import '@xterm/xterm/css/xterm.css';

interface TerminalViewProps {
  sessionId: string;
  serverName?: string;
  isActive?: boolean;
}

interface ReconnectHandler {
  (sessionId: string): Promise<void>;
}

export function TerminalView({ sessionId, serverName, isActive = true, onReconnect }: TerminalViewProps & { onReconnect?: ReconnectHandler }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSnippets, setShowSnippets] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'reconnecting'>('connected');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [termSettings, setTermSettings] = useState<TerminalSettings>(DEFAULT_TERMINAL_SETTINGS);
  const settingsLoadedRef = useRef(false);
  const lastSizeRef = useRef<{ cols: number; rows: number } | null>(null);
  const resizeRafRef = useRef<number | null>(null);

  const { getSession, reconnect } = useTerminal();
  const session = getSession(sessionId);
  // Only surface the initial-connect overlay; mid-session drops use the toasts below.
  const initialStatus =
    connectionStatus === 'connected' && (session?.status === 'connecting' || session?.status === 'error')
      ? session?.status
      : undefined;

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

  const toggleSearch = useCallback(() => {
    setShowSearch((prev) => {
      if (!prev) {
        setTimeout(() => searchInputRef.current?.focus(), 50);
      }
      return !prev;
    });
  }, []);

  const handlePasteToTerminal = useCallback((text: string) => {
    if (terminalRef.current) {
      window.electronAPI.ssh.sendData(sessionId, text);
    }
  }, [sessionId]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        toggleSearch();
      }
      if (e.key === 'Escape' && showSearch) {
        setShowSearch(false);
        terminalRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showSearch, toggleSearch]);

  useEffect(() => {
    if (isActive && fitAddonRef.current && terminalRef.current) {
      const timers = [
        setTimeout(() => {
          syncPtySize();
          terminalRef.current?.focus();
        }, 20),
        setTimeout(() => {
          syncPtySize();
        }, 120),
        setTimeout(() => {
          syncPtySize();
        }, 300),
      ];
      return () => timers.forEach((t) => clearTimeout(t));
    }
  }, [isActive, syncPtySize]);

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

    // Try WebGL renderer for better performance
    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => {
        webglAddon.dispose();
      });
      terminal.loadAddon(webglAddon);
    } catch {
      console.warn('WebGL addon failed to load, using canvas renderer');
    }

    // Initial PTY sync (with a delayed second pass after layout settles).
    syncPtySize();
    requestAnimationFrame(() => {
      syncPtySize();
    });

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
          .catch(() => {});
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
    <div className="flex h-full flex-col" style={{ backgroundColor: activeTheme.background }}>
      {/* Terminal Header */}
      <div className="drag-region flex h-10 items-center border-b border-[var(--border)] bg-[var(--surface-1)] px-4">
        <div className="flex items-center gap-2">
          {connectionStatus === 'connected' && (
            <div className="flex h-3 w-3 items-center justify-center rounded-full bg-green-500">
              <div className="h-1.5 w-1.5 rounded-full bg-green-300 animate-pulse" />
            </div>
          )}
          {connectionStatus === 'reconnecting' && (
            <div className="flex h-3 w-3 items-center justify-center rounded-full bg-yellow-500">
              <div className="h-1.5 w-1.5 rounded-full bg-yellow-300 animate-pulse" />
            </div>
          )}
          {connectionStatus === 'disconnected' && (
            <div className="h-3 w-3 rounded-full bg-red-500" />
          )}
          <span className="text-sm font-medium text-[var(--fg)]">
            {serverName || 'Terminal'}
          </span>
        </div>
      </div>

      {/* Terminal Container with floating toolbar */}
      <div className="relative flex-1">
        <div 
          ref={containerRef} 
          className="terminal-container absolute inset-0" 
          style={{ backgroundColor: activeTheme.background }}
        />

        <ConnectionOverlay
          status={initialStatus}
          serverName={serverName}
          error={session?.error}
          background={activeTheme.background}
          onRetry={() => {
            void reconnect(sessionId).catch(() => {});
          }}
        />

        {/* Floating Toolbar - bottom right */}
        <div className="absolute bottom-4 right-4 z-10 flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface-1)]/95 p-1 shadow-lg backdrop-blur-sm">
          {/* Snippets Button */}
          <div className="relative">
            <button
              onClick={() => setShowSnippets((prev) => !prev)}
              className={`rounded-md p-2 transition-colors ${
                showSnippets 
                  ? 'bg-[var(--accent-hover)] text-white' 
                  : 'text-[var(--fg-subtle)] hover:bg-[var(--border)] hover:text-[var(--fg)]'
              }`}
              title="Snippets (tokens, secrets)"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
              </svg>
            </button>
            {/* Snippets panel opens upward */}
            <div className="absolute bottom-full right-0 mb-2">
              <SnippetsPanel
                isOpen={showSnippets}
                onClose={() => setShowSnippets(false)}
                onPaste={handlePasteToTerminal}
              />
            </div>
          </div>

          {/* Divider */}
          <div className="h-5 w-px bg-[var(--border)]" />

          {/* Search Button */}
          <button
            onClick={toggleSearch}
            className={`rounded-md p-2 transition-colors ${
              showSearch 
                ? 'bg-[var(--accent-hover)] text-white' 
                : 'text-[var(--fg-subtle)] hover:bg-[var(--border)] hover:text-[var(--fg)]'
            }`}
            title="Search (Cmd/Ctrl+F)"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </button>

          {/* Keyboard shortcuts help */}
          <button
            onClick={() => setShowShortcuts(true)}
            className="rounded-md p-2 text-[var(--fg-subtle)] transition-colors hover:bg-[var(--border)] hover:text-[var(--fg)]"
            title="Keyboard shortcuts"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M8 14h8M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
            </svg>
          </button>
        </div>

        <KeyboardShortcutsModal
          isOpen={showShortcuts}
          onClose={() => setShowShortcuts(false)}
        />

        {/* Reconnect Toast */}
        {connectionStatus === 'disconnected' && onReconnect && (
          <div className="absolute left-1/2 top-4 z-20 -translate-x-1/2 flex items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-1)]/95 px-4 py-2.5 shadow-lg backdrop-blur-sm">
            <div className="h-2 w-2 rounded-full bg-red-500" />
            <span className="text-sm text-[var(--fg)]">Connection lost</span>
            <button
              onClick={async () => {
                setConnectionStatus('reconnecting');
                try {
                  await onReconnect(sessionId);
                  setConnectionStatus('connected');
                  terminalRef.current?.write('\r\n\x1b[38;5;114m⚡ Reconnected.\x1b[0m\r\n');
                } catch {
                  setConnectionStatus('disconnected');
                  terminalRef.current?.write('\r\n\x1b[38;5;203m✖ Reconnect failed.\x1b[0m\r\n');
                }
              }}
              className="rounded-md bg-[var(--accent)] px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-[var(--accent-hover)]"
            >
              Reconnect
            </button>
          </div>
        )}
        {connectionStatus === 'reconnecting' && (
          <div className="absolute left-1/2 top-4 z-20 -translate-x-1/2 flex items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-1)]/95 px-4 py-2.5 shadow-lg backdrop-blur-sm">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
            <span className="text-sm text-[var(--fg)]">Reconnecting...</span>
          </div>
        )}

        {/* Search Bar - floating above toolbar */}
        {showSearch && (
          <div className="absolute bottom-16 right-4 z-10 flex w-80 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-1)]/95 p-2 shadow-lg backdrop-blur-sm">
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
                if (e.key === 'Enter') {
                  handleSearch(e.shiftKey ? 'prev' : 'next');
                }
              }}
              placeholder="Search..."
              className="flex-1 rounded bg-[var(--border)] px-3 py-1.5 text-sm text-[var(--fg)] placeholder-[var(--fg-subtle)] outline-none"
            />
            <button
              onClick={() => handleSearch('prev')}
              className="rounded p-1.5 text-[var(--fg-subtle)] hover:bg-[var(--border)] hover:text-[var(--fg)]"
              title="Previous"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
              </svg>
            </button>
            <button
              onClick={() => handleSearch('next')}
              className="rounded p-1.5 text-[var(--fg-subtle)] hover:bg-[var(--border)] hover:text-[var(--fg)]"
              title="Next"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            <button
              onClick={() => {
                setShowSearch(false);
                setSearchQuery('');
                terminalRef.current?.focus();
              }}
              className="rounded p-1.5 text-[var(--fg-subtle)] hover:bg-[var(--border)] hover:text-[var(--fg)]"
              title="Close (Esc)"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
