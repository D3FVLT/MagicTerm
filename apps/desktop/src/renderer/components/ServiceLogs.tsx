import { useEffect, useRef, useState } from 'react';
import type { Server } from '@magicterm/shared';
import { useServices } from '../contexts/ServicesContext';
import { Button } from './ui/Button';
import type { DiscoveredService } from '../../common/monitor/types';

const MAX_LINES = 5000;

/** What journalctl or tail print when the user may not read the log. */
export const NEEDS_ROOT = /not seeing messages from other users|insufficient permissions|Permission denied|No journal files were opened|journal ACL/i;

interface ServiceLogsProps {
  server: Server;
  service: DiscoveredService;
  /** Asks for the sudo password; resolves to null when the user cancels. */
  askSudo: () => Promise<string | null>;
  /** The login user needs a password for sudo, so the log may be partial. */
  sudoNeedsPassword: boolean;
}

/** Follows a service's log over the background connection while it is shown. */
export function ServiceLogs({ server, service, askSudo, sudoNeedsPassword }: ServiceLogsProps) {
  const { connectionConfig } = useServices();
  const [lines, setLines] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [ended, setEnded] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  const [follow, setFollow] = useState(true);
  const streamId = useRef<string | null>(null);
  const partial = useRef('');
  const box = useRef<HTMLDivElement>(null);

  const stop = () => {
    if (streamId.current) void window.electronAPI.monitor.stopLogs(streamId.current);
    streamId.current = null;
    setRunning(false);
  };

  const start = async (sudoPassword?: string) => {
    stop();
    setLines([]);
    setEnded(null);
    setError('');
    partial.current = '';
    const id = crypto.randomUUID();
    streamId.current = id;
    setRunning(true);
    const config = await connectionConfig(server);
    const result = await window.electronAPI.monitor.startLogs(id, server.id, config, service, { lines: 200, sudoPassword });
    if (!result.success && streamId.current === id) {
      setError(result.error ?? 'Could not open the log');
      streamId.current = null;
      setRunning(false);
    }
  };

  useEffect(() => {
    const offData = window.electronAPI.monitor.onLogData((id, text) => {
      if (id !== streamId.current) return;
      const parts = (partial.current + text).split('\n');
      partial.current = parts.pop() ?? '';
      if (parts.length === 0) return;
      setLines((prev) => {
        const next = prev.concat(parts);
        return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
      });
    });
    const offEnd = window.electronAPI.monitor.onLogEnd((id, result) => {
      if (id !== streamId.current) return;
      if (partial.current) setLines((prev) => [...prev, partial.current]);
      partial.current = '';
      streamId.current = null;
      setRunning(false);
      setEnded(result.error ? `The log stopped: ${result.error}` : 'The log stopped.');
    });
    void start();
    return () => {
      offData();
      offEnd();
      stop();
    };
    // The log restarts only when another service is shown.
  }, [server.id, service.id]);

  useEffect(() => {
    if (follow && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [lines, follow]);

  const shown = filter ? lines.filter((line) => line.toLowerCase().includes(filter.toLowerCase())) : lines;
  const [usedSudo, setUsedSudo] = useState(false);
  const needsRoot = !usedSudo && (sudoNeedsPassword || lines.some((line) => NEEDS_ROOT.test(line)));

  return (
    <div className="mt-2">
      <div className="flex items-center gap-2 pb-1.5">
        <span className="text-xs font-medium text-fg-subtle">Log</span>
        {running && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-500" data-tooltip="Following" />}
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter"
          className="ml-2 w-40 border-b border-edge bg-transparent py-0.5 text-xs text-fg placeholder-fg-subtle outline-none focus:border-accent"
        />
        <label className="ml-2 flex items-center gap-1 text-xs text-fg-subtle">
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
          Scroll to new lines
        </label>
        <div className="ml-auto flex items-center gap-1">
          {needsRoot && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                void askSudo().then((password) => {
                  if (!password) return;
                  setUsedSudo(true);
                  void start(password);
                });
              }}
            >
              Read with sudo
            </Button>
          )}
          {running ? (
            <Button variant="ghost" size="sm" onClick={stop}>Stop</Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => void start()}>Follow again</Button>
          )}
        </div>
      </div>
      <div
        ref={box}
        className="h-72 overflow-auto rounded-md border border-edge bg-app px-2 py-1.5 font-mono text-[11px] leading-[1.45] text-fg"
        onScroll={(e) => {
          const el = e.currentTarget;
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
          if (atBottom !== follow) setFollow(atBottom);
        }}
      >
        {shown.length === 0 && !error && (
          <div className="text-fg-subtle">{running ? 'Waiting for log lines' : 'No log lines'}</div>
        )}
        {shown.map((line, index) => (
          <div key={index} className="whitespace-pre-wrap break-all">{line || ' '}</div>
        ))}
        {error && <div className="text-red-500">{error}</div>}
        {ended && <div className="pt-1 text-fg-subtle">{ended}</div>}
      </div>
      {lines.length >= MAX_LINES && <p className="pt-1 text-xs text-fg-subtle">Showing the last {MAX_LINES} lines.</p>}
    </div>
  );
}
