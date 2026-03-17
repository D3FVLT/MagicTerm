import { useEffect, useRef, useCallback, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import '@xterm/xterm/css/xterm.css';

interface TerminalViewProps {
  sessionId: string;
  serverName?: string;
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

export function TerminalView({ sessionId, serverName }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
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
      {/* Terminal Header */}
      <div className="drag-region flex h-10 items-center justify-between border-b border-[#292e42] bg-[#1f2335] px-4">
        <div className="flex items-center gap-2">
          <div className="flex h-3 w-3 items-center justify-center rounded-full bg-green-500">
            <div className="h-1.5 w-1.5 rounded-full bg-green-300 animate-pulse" />
          </div>
          <span className="text-sm font-medium text-[#c0caf5]">
            {serverName || 'Terminal'}
          </span>
        </div>
        
        <div className="flex items-center gap-1">
          {/* Search Button */}
          <button
            onClick={toggleSearch}
            className={`rounded p-1.5 transition-colors ${
              showSearch 
                ? 'bg-[#3d59a1] text-white' 
                : 'text-[#565f89] hover:bg-[#292e42] hover:text-[#c0caf5]'
            }`}
            title="Search (Cmd+F)"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Search Bar */}
      {showSearch && (
        <div className="flex items-center gap-2 border-b border-[#292e42] bg-[#1f2335] px-4 py-2">
          <div className="relative flex-1">
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
              className="w-full rounded bg-[#292e42] px-3 py-1.5 text-sm text-[#c0caf5] placeholder-[#565f89] outline-none ring-1 ring-[#3d59a1]/30 focus:ring-[#7aa2f7]"
            />
          </div>
          <button
            onClick={() => handleSearch('prev')}
            className="rounded p-1.5 text-[#565f89] hover:bg-[#292e42] hover:text-[#c0caf5]"
            title="Previous (Shift+Enter)"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
            </svg>
          </button>
          <button
            onClick={() => handleSearch('next')}
            className="rounded p-1.5 text-[#565f89] hover:bg-[#292e42] hover:text-[#c0caf5]"
            title="Next (Enter)"
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

      {/* Terminal Container */}
      <div 
        ref={containerRef} 
        className="terminal-container flex-1" 
        style={{ backgroundColor: TERMIUS_THEME.background }}
      />
    </div>
  );
}
