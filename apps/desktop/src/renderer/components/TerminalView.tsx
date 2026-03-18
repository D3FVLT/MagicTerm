import { useEffect, useRef, useCallback, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { SnippetsPanel } from './SnippetsPanel';
import '@xterm/xterm/css/xterm.css';

interface TerminalViewProps {
  sessionId: string;
  serverName?: string;
  isActive?: boolean;
}

const TERMIUS_THEME = {
  background: '#1a1b26',
  foreground: '#c0caf5',
  cursor: '#c0caf5',
  cursorAccent: '#1a1b26',
  selectionBackground: '#33467c',
  selectionForeground: '#c0caf5',
  selectionInactiveBackground: '#283457',
  black: '#15161e',
  red: '#f7768e',
  green: '#9ece6a',
  yellow: '#e0af68',
  blue: '#7aa2f7',
  magenta: '#bb9af7',
  cyan: '#7dcfff',
  white: '#a9b1d6',
  brightBlack: '#414868',
  brightRed: '#f7768e',
  brightGreen: '#9ece6a',
  brightYellow: '#e0af68',
  brightBlue: '#7aa2f7',
  brightMagenta: '#bb9af7',
  brightCyan: '#7dcfff',
  brightWhite: '#c0caf5',
};

export function TerminalView({ sessionId, serverName, isActive = true }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSnippets, setShowSnippets] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const handleResize = useCallback(() => {
    if (fitAddonRef.current && terminalRef.current && containerRef.current) {
      try {
        fitAddonRef.current.fit();
        const { cols, rows } = terminalRef.current;
        if (cols && rows) {
          window.electronAPI.ssh.resize(sessionId, { cols, rows });
        }
      } catch {
        // Terminal not ready yet
      }
    }
  }, [sessionId]);

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
      const timer = setTimeout(() => {
        try {
          fitAddonRef.current?.fit();
          terminalRef.current?.focus();
        } catch {
        }
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isActive]);

  useEffect(() => {
    if (!containerRef.current) return;

    const terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      cursorWidth: 2,
      fontSize: 13,
      fontFamily: '"JetBrains Mono", "Fira Code", "SF Mono", Menlo, Monaco, "Courier New", monospace',
      fontWeight: '400',
      fontWeightBold: '600',
      letterSpacing: 0,
      lineHeight: 1.2,
      theme: TERMIUS_THEME,
      allowTransparency: false,
      scrollback: 10000,
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

    fitAddon.fit();

    const { cols, rows } = terminal;
    window.electronAPI.ssh.resize(sessionId, { cols, rows });

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
          } else if (status === 'error') {
            terminal.write(`\r\n\x1b[38;5;203m✖ Error: ${error}\x1b[0m\r\n`);
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
      terminal.dispose();
    };
  }, [sessionId, handleResize]);

  return (
    <div className="flex h-full flex-col bg-[#1a1b26]">
      {/* Terminal Header - minimal, just for drag and status */}
      <div className="drag-region flex h-10 items-center border-b border-[#292e42] bg-[#1f2335] px-4">
        <div className="flex items-center gap-2">
          <div className="flex h-3 w-3 items-center justify-center rounded-full bg-green-500">
            <div className="h-1.5 w-1.5 rounded-full bg-green-300 animate-pulse" />
          </div>
          <span className="text-sm font-medium text-[#c0caf5]">
            {serverName || 'Terminal'}
          </span>
        </div>
      </div>

      {/* Terminal Container with floating toolbar */}
      <div className="relative flex-1">
        <div 
          ref={containerRef} 
          className="terminal-container absolute inset-0" 
          style={{ backgroundColor: TERMIUS_THEME.background }}
        />

        {/* Floating Toolbar - bottom right */}
        <div className="absolute bottom-4 right-4 z-10 flex items-center gap-1 rounded-lg border border-[#292e42] bg-[#1f2335]/95 p-1 shadow-lg backdrop-blur-sm">
          {/* Snippets Button */}
          <div className="relative">
            <button
              onClick={() => setShowSnippets((prev) => !prev)}
              className={`rounded-md p-2 transition-colors ${
                showSnippets 
                  ? 'bg-[#3d59a1] text-white' 
                  : 'text-[#565f89] hover:bg-[#292e42] hover:text-[#c0caf5]'
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
          <div className="h-5 w-px bg-[#292e42]" />

          {/* Search Button */}
          <button
            onClick={toggleSearch}
            className={`rounded-md p-2 transition-colors ${
              showSearch 
                ? 'bg-[#3d59a1] text-white' 
                : 'text-[#565f89] hover:bg-[#292e42] hover:text-[#c0caf5]'
            }`}
            title="Search (Cmd/Ctrl+F)"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </button>
        </div>

        {/* Search Bar - floating above toolbar */}
        {showSearch && (
          <div className="absolute bottom-16 right-4 z-10 flex w-80 items-center gap-2 rounded-lg border border-[#292e42] bg-[#1f2335]/95 p-2 shadow-lg backdrop-blur-sm">
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
              className="flex-1 rounded bg-[#292e42] px-3 py-1.5 text-sm text-[#c0caf5] placeholder-[#565f89] outline-none"
            />
            <button
              onClick={() => handleSearch('prev')}
              className="rounded p-1.5 text-[#565f89] hover:bg-[#292e42] hover:text-[#c0caf5]"
              title="Previous"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
              </svg>
            </button>
            <button
              onClick={() => handleSearch('next')}
              className="rounded p-1.5 text-[#565f89] hover:bg-[#292e42] hover:text-[#c0caf5]"
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
              className="rounded p-1.5 text-[#565f89] hover:bg-[#292e42] hover:text-[#c0caf5]"
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
