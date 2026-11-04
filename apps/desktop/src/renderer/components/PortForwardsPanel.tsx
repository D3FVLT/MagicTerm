import { useEffect, useMemo, useState } from 'react';
import { useServers } from '../contexts/ServersContext';
import { usePortForwards } from '../contexts/PortForwardsContext';
import {
  KIND_LABELS,
  browserUrl,
  describePreset,
  findPortClash,
  localAddress,
  validatePreset,
  type PortForwardKind,
  type PortForwardPreset,
  type PortForwardStatus,
} from '../../common/port-forward';

interface PortForwardsPanelProps {
  tabId: string;
  serverId: string;
  onClose: () => void;
}

const inputClass =
  'w-full rounded-md border border-[var(--border)] bg-transparent px-2 py-1 text-[13px] text-[var(--fg)] outline-none placeholder:text-[var(--fg-subtle)] focus:border-[var(--accent)]';

const KIND_HINTS: Record<PortForwardKind, string> = {
  local: 'Opens a port on this computer that reaches a host and port through the server, like ssh -L.',
  remote: 'Opens a port on the server that reaches a host and port from this computer, like ssh -R.',
  dynamic: 'Runs a SOCKS5 proxy on this computer that sends traffic through the server, like ssh -D.',
};

interface Draft {
  id: string | null;
  kind: PortForwardKind;
  label: string;
  listenPort: string;
  targetHost: string;
  targetPort: string;
  allInterfaces: boolean;
  autoStart: boolean;
}

function emptyDraft(kind: PortForwardKind = 'local'): Draft {
  return {
    id: null,
    kind,
    label: '',
    listenPort: kind === 'dynamic' ? '1080' : '',
    targetHost: '127.0.0.1',
    targetPort: '',
    allInterfaces: false,
    autoStart: false,
  };
}

function draftFrom(preset: PortForwardPreset): Draft {
  return {
    id: preset.id,
    kind: preset.kind,
    label: preset.label ?? '',
    listenPort: String(preset.listenPort),
    targetHost: preset.targetHost ?? '127.0.0.1',
    targetPort: preset.targetPort ? String(preset.targetPort) : '',
    allInterfaces: Boolean(preset.allInterfaces),
    autoStart: Boolean(preset.autoStart),
  };
}

function presetFrom(draft: Draft): PortForwardPreset {
  const preset: PortForwardPreset = {
    id: draft.id ?? crypto.randomUUID(),
    kind: draft.kind,
    listenPort: Number(draft.listenPort.trim()),
  };
  if (draft.label.trim()) preset.label = draft.label.trim();
  if (draft.kind !== 'dynamic') {
    preset.targetHost = draft.targetHost.trim();
    preset.targetPort = Number(draft.targetPort.trim());
  }
  if (draft.allInterfaces) preset.allInterfaces = true;
  if (draft.autoStart) preset.autoStart = true;
  return preset;
}

function StatusLine({ preset, status }: { preset: PortForwardPreset; status?: PortForwardStatus }) {
  const [copied, setCopied] = useState(false);
  if (!status) return null;
  if (status.state === 'starting') {
    return <div className="text-xs text-[var(--fg-subtle)]">Starting…</div>;
  }
  if (status.state === 'error') {
    return <div className="text-xs text-red-400">{status.error}</div>;
  }
  if (status.state !== 'listening') return null;

  const address = localAddress(preset);
  const url = browserUrl(preset);
  return (
    <div className="space-y-0.5 text-xs">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-green-500">
        <span>Listening</span>
        {address && (
          <>
            {url ? (
              <a href={url} target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] hover:underline">
                {url}
              </a>
            ) : (
              <span className="font-mono text-[var(--fg)]">{preset.kind === 'dynamic' ? `socks5h://${address}` : address}</span>
            )}
            <button
              type="button"
              onClick={() => {
                const text = url ?? (preset.kind === 'dynamic' ? `socks5h://${address}` : address);
                void window.electronAPI.clipboard.writeText(text).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1200);
                });
              }}
              className="text-[var(--fg-subtle)] hover:text-[var(--fg)]"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </>
        )}
        {status.connections > 0 && (
          <span className="text-[var(--fg-subtle)]">
            {status.connections} {status.connections === 1 ? 'connection' : 'connections'}
          </span>
        )}
      </div>
      {status.warning && <div className="text-amber-500">{status.warning}</div>}
    </div>
  );
}

export function PortForwardsPanel({ tabId, serverId, onClose }: PortForwardsPanelProps) {
  const { servers, decryptServerForwards, saveServerForwards } = useServers();
  const { statusesFor, start, stop } = usePortForwards();
  const server = servers.find((s) => s.id === serverId);
  const [presets, setPresets] = useState<PortForwardPreset[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const statuses = statusesFor(tabId);

  useEffect(() => {
    if (!server) return;
    let cancelled = false;
    decryptServerForwards(server)
      .then((list) => {
        if (!cancelled) setPresets(list);
      })
      .catch(() => {
        if (!cancelled) setLoadError('Could not decrypt the saved forwards.');
      });
    return () => {
      cancelled = true;
    };
    // Re-read when the stored list changes, including from another device.
  }, [server?.portForwards]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const isRunning = (id: string) => {
    const state = statuses[id]?.state;
    return state === 'listening' || state === 'starting';
  };

  const runningCount = useMemo(
    () => Object.values(statuses).filter((s) => s.state === 'listening').length,
    [statuses]
  );

  const persist = async (next: PortForwardPreset[]) => {
    await saveServerForwards(serverId, next);
    setPresets(next);
  };

  const handleSave = async () => {
    if (!draft || !presets) return;
    const preset = presetFrom(draft);
    const invalid = validatePreset(preset);
    if (invalid) {
      setFormError(invalid);
      return;
    }
    const clash = findPortClash(presets, preset);
    if (clash) {
      setFormError(
        `Port ${preset.listenPort} is already used by ${clash.label ? `"${clash.label}"` : describePreset(clash)}.`
      );
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      const exists = presets.some((p) => p.id === preset.id);
      const next = exists ? presets.map((p) => (p.id === preset.id ? preset : p)) : [...presets, preset];
      await persist(next);
      setDraft(null);
      // An edited forward that was running restarts with the new settings; a new one starts right away.
      if (!exists || isRunning(preset.id)) void start(tabId, preset);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not save the forward.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (preset: PortForwardPreset) => {
    if (!presets) return;
    try {
      if (isRunning(preset.id) || statuses[preset.id]) await stop(tabId, preset.id);
      await persist(presets.filter((p) => p.id !== preset.id));
      if (draft?.id === preset.id) setDraft(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not delete the forward.');
    }
  };

  const toggle = (preset: PortForwardPreset) => {
    if (isRunning(preset.id)) void stop(tabId, preset.id);
    else void start(tabId, preset);
  };

  const setField = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
    setFormError('');
  };

  return (
    <div
      className="animate-slide-down absolute right-0 top-full z-50 mt-2 w-[420px] max-w-[calc(100vw-32px)] rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-xl"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-2.5">
        <div>
          <div className="text-sm font-medium text-[var(--fg)]">Port forwarding</div>
          <div className="text-xs text-[var(--fg-subtle)]">
            {server?.name ?? 'Server'}
            {runningCount > 0 ? ` · ${runningCount} running` : ''}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-[var(--fg-subtle)] hover:bg-[var(--border)] hover:text-[var(--fg)]"
          aria-label="Close"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="max-h-[60vh] overflow-y-auto">
        {loadError && <div className="px-4 py-2 text-xs text-red-400">{loadError}</div>}
        {presets === null && !loadError && (
          <div className="px-4 py-3 text-xs text-[var(--fg-subtle)]">Loading…</div>
        )}
        {presets?.length === 0 && !draft && (
          <div className="px-4 py-3 text-xs text-[var(--fg-subtle)]">
            No forwards saved for this server. Forwards you add are saved with the server, encrypted like its address.
          </div>
        )}
        {presets?.map((preset) => {
          const status = statuses[preset.id];
          const running = isRunning(preset.id);
          return (
            <div key={preset.id} className="flex items-start gap-3 border-b border-[var(--border)] px-4 py-2.5">
              <input
                type="checkbox"
                role="switch"
                checked={running}
                onChange={() => toggle(preset)}
                aria-label={running ? 'Stop forward' : 'Start forward'}
                className="mt-1 h-4 w-4 shrink-0 accent-[var(--accent)]"
              />
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 shrink-0 rounded bg-[var(--border)] px-1.5 py-px text-[10px] uppercase tracking-wide text-[var(--fg-subtle)]">
                    {KIND_LABELS[preset.kind]}
                  </span>
                  <span className="min-w-0 break-words text-sm text-[var(--fg)]">{preset.label ?? describePreset(preset)}</span>
                </div>
                {preset.label && <div className="break-words font-mono text-xs text-[var(--fg-subtle)]">{describePreset(preset)}</div>}
                <StatusLine preset={preset} status={status} />
              </div>
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setDraft(draftFrom(preset));
                    setFormError('');
                  }}
                  className="rounded px-1.5 py-0.5 text-xs text-[var(--fg-subtle)] hover:bg-[var(--border)] hover:text-[var(--fg)]"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => void handleDelete(preset)}
                  className="rounded px-1.5 py-0.5 text-xs text-[var(--fg-subtle)] hover:bg-[var(--border)] hover:text-red-400"
                >
                  Delete
                </button>
              </div>
            </div>
          );
        })}

        {draft && (
          <div className="space-y-2.5 border-b border-[var(--border)] px-4 py-3">
            <div className="flex gap-1 rounded-md bg-[var(--border)] p-0.5">
              {(['local', 'remote', 'dynamic'] as PortForwardKind[]).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() =>
                    setDraft((prev) =>
                      prev
                        ? {
                            ...prev,
                            kind,
                            listenPort: kind === 'dynamic' && !prev.listenPort ? '1080' : prev.listenPort,
                          }
                        : prev
                    )
                  }
                  className={`flex-1 rounded px-2 py-1 text-xs ${
                    draft.kind === kind ? 'bg-[var(--surface-1)] text-[var(--fg)] shadow-sm' : 'text-[var(--fg-subtle)] hover:text-[var(--fg)]'
                  }`}
                >
                  {KIND_LABELS[kind]}
                </button>
              ))}
            </div>
            <div className="text-xs text-[var(--fg-subtle)]">{KIND_HINTS[draft.kind]}</div>

            <label className="block space-y-1">
              <span className="text-xs text-[var(--fg-subtle)]">{draft.kind === 'remote' ? 'Port on the server' : 'Port on this computer'}</span>
              <input
                value={draft.listenPort}
                onChange={(e) => setField('listenPort', e.target.value)}
                inputMode="numeric"
                placeholder={draft.kind === 'dynamic' ? '1080' : '8080'}
                className={inputClass}
                autoFocus
              />
            </label>

            {draft.kind !== 'dynamic' && (
              <div className="flex gap-2">
                <label className="block flex-1 space-y-1">
                  <span className="text-xs text-[var(--fg-subtle)]">
                    {draft.kind === 'local' ? 'Host, as seen from the server' : 'Host, as seen from this computer'}
                  </span>
                  <input
                    value={draft.targetHost}
                    onChange={(e) => setField('targetHost', e.target.value)}
                    placeholder="127.0.0.1"
                    className={inputClass}
                  />
                </label>
                <label className="block w-24 space-y-1">
                  <span className="text-xs text-[var(--fg-subtle)]">Port</span>
                  <input
                    value={draft.targetPort}
                    onChange={(e) => setField('targetPort', e.target.value)}
                    inputMode="numeric"
                    placeholder="80"
                    className={inputClass}
                  />
                </label>
              </div>
            )}

            <label className="block space-y-1">
              <span className="text-xs text-[var(--fg-subtle)]">Name (optional)</span>
              <input
                value={draft.label}
                onChange={(e) => setField('label', e.target.value)}
                placeholder={draft.kind === 'local' ? 'Web panel' : ''}
                className={inputClass}
              />
            </label>

            <label className="flex items-center gap-2 text-xs text-[var(--fg)]">
              <input
                type="checkbox"
                checked={draft.autoStart}
                onChange={(e) => setField('autoStart', e.target.checked)}
                className="h-3.5 w-3.5 accent-[var(--accent)]"
              />
              Start when a terminal to this server connects
            </label>
            <label className="flex items-start gap-2 text-xs text-[var(--fg)]">
              <input
                type="checkbox"
                checked={draft.allInterfaces}
                onChange={(e) => setField('allInterfaces', e.target.checked)}
                className="mt-px h-3.5 w-3.5 accent-[var(--accent)]"
              />
              <span>
                {draft.kind === 'remote'
                  ? 'Listen on all server interfaces, not only localhost. The server needs GatewayPorts set in sshd_config.'
                  : 'Let other devices on my network use this port. Off by default: only this computer can connect.'}
              </span>
            </label>

            {formError && <div className="text-xs text-red-400">{formError}</div>}

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setDraft(null);
                  setFormError('');
                }}
                className="rounded-md px-3 py-1 text-xs text-[var(--fg-subtle)] hover:bg-[var(--border)] hover:text-[var(--fg)]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleSave()}
                className="rounded-md bg-[var(--accent)] px-3 py-1 text-xs font-medium text-[var(--accent-fg)] hover:bg-[var(--accent-hover)] disabled:opacity-50"
              >
                {saving ? 'Saving…' : draft.id ? 'Save' : 'Save and start'}
              </button>
            </div>
          </div>
        )}
      </div>

      {!draft && presets !== null && (
        <div className="px-4 py-2.5">
          <button
            type="button"
            onClick={() => {
              setDraft(emptyDraft());
              setFormError('');
            }}
            className="text-xs font-medium text-[var(--accent)] hover:underline"
          >
            Add forward
          </button>
        </div>
      )}
    </div>
  );
}
