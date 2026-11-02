import { useEffect, useState, useSyncExternalStore } from 'react';
import { useServers } from '../contexts/ServersContext';
import { mcpClientSnippet, type McpClient, type McpLaunch } from '../../common/mcp-client-config';
import type { McpSettings as Settings } from '../../common/mcp-tools';
import { mcpActivity, subscribeMcpActivity } from '../lib/mcp-activity';

const CLIENTS: { id: McpClient; label: string; where: string }[] = [
  { id: 'claude', label: 'Claude Code', where: 'Run in a terminal' },
  { id: 'cursor', label: 'Cursor', where: 'Add to ~/.cursor/mcp.json' },
  { id: 'codex', label: 'Codex', where: 'Add to ~/.codex/config.toml' },
];

export function McpSettings() {
  const { servers } = useServers();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [launch, setLaunch] = useState<McpLaunch | null>(null);
  const [client, setClient] = useState<McpClient>('claude');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const activity = useSyncExternalStore(subscribeMcpActivity, mcpActivity);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([window.electronAPI.mcp.getSettings(), window.electronAPI.mcp.clientConfig()]).then(([loaded, config]) => {
      if (cancelled) return;
      setSettings(loaded.settings);
      setLaunch(config.config);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const save = async (next: Settings) => {
    setError('');
    const result = await window.electronAPI.mcp.setSettings(next);
    if (result.success) setSettings(result.settings);
    else setError('Could not save');
  };

  const snippet = launch ? mcpClientSnippet(client, launch) : '';

  return (
    <div>
      <p className="border-b border-edge py-3 text-sm text-fg-muted">
        Let Claude Code, Cursor or Codex list your servers, read open terminals and run commands through MagicTerm.
        They never see passwords or keys. Every command waits for you to approve it here, and nothing works while the vault is locked.
      </p>

      <label className="flex items-center gap-2 border-b border-edge py-3 text-sm text-fg">
        <input
          type="checkbox"
          className="h-4 w-4 accent-accent"
          checked={Boolean(settings?.enabled)}
          disabled={!settings}
          onChange={(event) => settings && void save({ ...settings, enabled: event.target.checked })}
        />
        Allow AI tools (MCP)
      </label>

      <div className="border-b border-edge py-3">
        <p className="text-sm text-fg">Servers AI tools can use</p>
        <p className="mt-0.5 text-xs text-fg-subtle">From the vault that is open now. None are allowed until you tick them.</p>
        <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
          {servers.length === 0 && <li className="text-sm text-fg-subtle">No servers in this vault.</li>}
          {servers.map((server) => (
            <li key={server.id}>
              <label className="flex items-center gap-2 text-sm text-fg-muted">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 accent-accent"
                  checked={Boolean(settings?.serverIds.includes(server.id))}
                  disabled={!settings}
                  onChange={(event) => {
                    if (!settings) return;
                    const serverIds = event.target.checked
                      ? [...settings.serverIds, server.id]
                      : settings.serverIds.filter((id) => id !== server.id);
                    void save({ ...settings, serverIds });
                  }}
                />
                <span className="truncate">{server.name}</span>
              </label>
            </li>
          ))}
        </ul>
      </div>

      <div className="border-b border-edge py-3">
        <p className="text-sm text-fg">Connect a client</p>
        <div className="mt-2 flex gap-3 text-xs" role="tablist">
          {CLIENTS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={client === item.id}
              className={client === item.id ? 'border-b border-accent text-fg' : 'text-fg-subtle hover:text-fg'}
              onClick={() => setClient(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-fg-subtle">{CLIENTS.find((item) => item.id === client)?.where}</p>
        <div className="mt-1 overflow-hidden rounded-lg border border-edge bg-surface-2">
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all px-2 py-1.5 font-mono text-xs text-fg">
            {snippet || 'Loading…'}
          </pre>
          <div className="flex justify-end px-1.5 pb-1">
            <button
              type="button"
              className="rounded px-2 py-0.5 text-xs text-fg-muted hover:bg-surface-3 hover:text-fg"
              disabled={!snippet}
              onClick={() => {
                void window.electronAPI.clipboard.writeText(snippet).then((result) => {
                  if (result.success) setCopied(true);
                });
              }}
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
        <p className="mt-1 text-xs text-fg-subtle">MagicTerm must be open for the client to connect.</p>
      </div>

      <div className="py-3">
        <p className="text-sm text-fg">Activity</p>
        {activity.length === 0 ? (
          <p className="mt-0.5 text-xs text-fg-subtle">Nothing since MagicTerm started.</p>
        ) : (
          <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
            {activity.map((entry) => (
              <li key={entry.id} className="flex gap-2 text-xs">
                <span className="shrink-0 tabular-nums text-fg-subtle">
                  {new Date(entry.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
                <span className={entry.outcome === 'ok' ? 'text-fg-muted' : entry.outcome === 'denied' ? 'text-warning' : 'text-danger'}>
                  {entry.client}: {entry.tool}
                  {entry.target ? ` · ${entry.target}` : ''}
                  {entry.detail ? ` · ${entry.detail}` : ''}
                  {entry.outcome === 'denied' ? ' · denied' : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && <p className="pb-2 text-sm text-danger" role="alert">{error}</p>}
    </div>
  );
}
