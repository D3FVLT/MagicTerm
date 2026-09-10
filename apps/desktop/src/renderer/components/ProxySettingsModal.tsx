import { useState, useEffect } from 'react';

interface ProxyConfig {
  enabled: boolean;
  type: 'http' | 'socks5';
  host: string;
  port: number;
  username: string;
  password: string;
}

interface ProxySettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called after the new settings have been applied, before the modal closes. */
  onSaved?: () => void;
}

/**
 * Proxy settings that must stay reachable without an account: a bad proxy takes
 * out every Supabase call, so anything gated behind sign-in would be a dead end.
 */
export function ProxySettingsModal({ isOpen, onClose, onSaved }: ProxySettingsModalProps) {
  const [config, setConfig] = useState<ProxyConfig>({
    enabled: false,
    type: 'http',
    host: '',
    port: 8080,
    username: '',
    password: '',
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testResult, setTestResult] = useState<{ status: 'idle' | 'testing' | 'ok' | 'fail'; message?: string }>({ status: 'idle' });

  useEffect(() => {
    if (!isOpen) return;
    window.electronAPI.proxy.get().then((result) => {
      if (result.success && result.config) {
        setConfig({ ...config, ...result.config, type: (result.config.type === 'socks5' ? 'socks5' : 'http') as ProxyConfig['type'] });
      }
    });
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSave = async () => {
    setSaving(true);
    try {
      await window.electronAPI.proxy.set(config);
      setSaved(true);
      setTimeout(() => {
        setSaved(false);
        onSaved?.();
        onClose();
      }, 1000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/60" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className="flex max-h-[90vh] w-full max-w-md flex-col rounded-xl border border-edge bg-surface-1 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <h3 className="flex-shrink-0 px-6 pt-6 text-lg font-semibold text-fg">Proxy Settings</h3>

          <div className="overflow-y-auto px-6 py-4 space-y-4">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={config.enabled}
                onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
                className="h-4 w-4 rounded border-edge-strong bg-surface-2 text-primary-500 focus:ring-primary-500 focus:ring-offset-0"
              />
              <span className="text-sm text-fg-muted">Enable proxy</span>
            </label>

            {config.enabled && (
              <>
                <div>
                  <label className="mb-1 block text-sm text-fg-muted">Type</label>
                  <select
                    value={config.type}
                    onChange={(e) => setConfig({ ...config, type: e.target.value as 'http' | 'socks5' })}
                    className="w-full rounded-lg border border-edge bg-surface-2 px-3 py-2 text-sm text-fg outline-none focus:border-primary-500"
                  >
                    <option value="http">HTTP</option>
                    <option value="socks5">SOCKS5</option>
                  </select>
                </div>

                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="mb-1 block text-sm text-fg-muted">Host</label>
                    <input
                      type="text"
                      value={config.host}
                      onChange={(e) => setConfig({ ...config, host: e.target.value })}
                      placeholder="127.0.0.1"
                      className="w-full rounded-lg border border-edge bg-surface-2 px-3 py-2 text-sm text-fg placeholder-fg-subtle outline-none focus:border-primary-500"
                    />
                  </div>
                  <div className="w-24">
                    <label className="mb-1 block text-sm text-fg-muted">Port</label>
                    <input
                      type="number"
                      value={config.port}
                      onChange={(e) => setConfig({ ...config, port: Number(e.target.value) })}
                      className="w-full rounded-lg border border-edge bg-surface-2 px-3 py-2 text-sm text-fg outline-none focus:border-primary-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-sm text-fg-muted">Username (optional)</label>
                  <input
                    type="text"
                    value={config.username}
                    onChange={(e) => setConfig({ ...config, username: e.target.value })}
                    className="w-full rounded-lg border border-edge bg-surface-2 px-3 py-2 text-sm text-fg placeholder-fg-subtle outline-none focus:border-primary-500"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm text-fg-muted">Password (optional)</label>
                  <input
                    type="password"
                    value={config.password}
                    onChange={(e) => setConfig({ ...config, password: e.target.value })}
                    className="w-full rounded-lg border border-edge bg-surface-2 px-3 py-2 text-sm text-fg placeholder-fg-subtle outline-none focus:border-primary-500"
                  />
                </div>
              </>
            )}

            <div className="flex items-center gap-3">
              <button
                onClick={async () => {
                  setTestResult({ status: 'testing' });
                  await window.electronAPI.proxy.set(config);
                  const result = await window.electronAPI.proxy.test();
                  if (result.success) {
                    setTestResult({ status: 'ok', message: `Connected (IP: ${result.ip})` });
                  } else {
                    setTestResult({ status: 'fail', message: result.error });
                  }
                  setTimeout(() => setTestResult({ status: 'idle' }), 5000);
                }}
                disabled={testResult.status === 'testing'}
                className="rounded-lg border border-edge bg-surface-2 px-3 py-1.5 text-xs font-medium text-fg transition-colors hover:border-primary-500 hover:text-primary-400 disabled:opacity-50"
              >
                {testResult.status === 'testing' ? 'Testing...' : 'Test Connection'}
              </button>
              {testResult.status === 'ok' && (
                <span className="text-xs text-green-400">{testResult.message}</span>
              )}
              {testResult.status === 'fail' && (
                <span className="text-xs text-red-400">{testResult.message}</span>
              )}
            </div>
          </div>

          <div className="flex flex-shrink-0 justify-end gap-3 border-t border-edge px-6 py-4">
            <button
              onClick={onClose}
              className="rounded-lg border border-edge bg-transparent px-4 py-2 text-sm font-medium text-fg transition-colors hover:bg-surface-2"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="rounded-lg bg-primary-500 px-4 py-2 text-sm font-medium text-fg transition-colors hover:bg-primary-600 disabled:opacity-50"
            >
              {saved ? 'Saved!' : saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
