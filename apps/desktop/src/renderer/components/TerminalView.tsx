import { useEffect, useRef, useCallback } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

interface TerminalViewProps {
  sessionId: string;
}

export function TerminalView({ sessionId }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  const handleResize = useCallback(() => {
    if (fitAddonRef.current && terminalRef.current) {
      fitAddonRef.current.fit();
      const { cols, rows } = terminalRef.current;
      window.electronAPI.ssh.resize(sessionId, { cols, rows });
    }
  }, [sessionId]);

  useEffect(() => {
    if (!containerRef.current) return;

    const terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#0a0a0a',
        foreground: '#e5e5e5',
        cursor: '#3b82f6',
        cursorAccent: '#0a0a0a',
        selectionBackground: '#3b82f680',
        black: '#000000',
        red: '#ef4444',
        green: '#22c55e',
        yellow: '#eab308',
        blue: '#3b82f6',
        magenta: '#a855f7',
        cyan: '#06b6d4',
        white: '#e5e5e5',
        brightBlack: '#6b7280',
        brightRed: '#f87171',
        brightGreen: '#4ade80',
        brightYellow: '#facc15',
        brightBlue: '#60a5fa',
        brightMagenta: '#c084fc',
        brightCyan: '#22d3ee',
        brightWhite: '#ffffff',
      },
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    terminal.open(containerRef.current);
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
            terminal.write('\r\n\x1b[33mConnection closed.\x1b[0m\r\n');
          } else if (status === 'error') {
            terminal.write(`\r\n\x1b[31mError: ${error}\x1b[0m\r\n`);
          }
        }
      }
    );

    const resizeObserver = new ResizeObserver(() => {
      handleResize();
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      removeDataListener();
      removeStatusListener();
      resizeObserver.disconnect();
      terminal.dispose();
    };
  }, [sessionId, handleResize]);

  return (
    <div className="flex h-full flex-col bg-[#0a0a0a]">
      <div className="drag-region flex h-10 items-center border-b border-gray-800 px-4">
        <span className="text-sm text-gray-400">Terminal</span>
      </div>
      <div ref={containerRef} className="terminal-container flex-1" />
    </div>
  );
}
