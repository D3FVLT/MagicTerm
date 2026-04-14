import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';

interface ProxyConfig {
  enabled: boolean;
  type: 'http' | 'socks5';
  host: string;
  port: number;
  username: string;
  password: string;
}

function ProxySettingsModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
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
          className="w-full max-w-md rounded-xl border border-gray-700 bg-gray-900 p-6 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <h3 className="mb-4 text-lg font-semibold text-white">Proxy Settings</h3>

          <div className="space-y-4">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={config.enabled}
                onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
                className="h-4 w-4 rounded border-gray-600 bg-gray-800 text-primary-500 focus:ring-primary-500 focus:ring-offset-0"
              />
              <span className="text-sm text-gray-300">Enable proxy</span>
            </label>

            {config.enabled && (
              <>
                <div>
                  <label className="mb-1 block text-sm text-gray-400">Type</label>
                  <select
                    value={config.type}
                    onChange={(e) => setConfig({ ...config, type: e.target.value as 'http' | 'socks5' })}
                    className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white outline-none focus:border-primary-500"
                  >
                    <option value="http">HTTP</option>
                    <option value="socks5">SOCKS5</option>
                  </select>
                </div>

                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="mb-1 block text-sm text-gray-400">Host</label>
                    <input
                      type="text"
                      value={config.host}
                      onChange={(e) => setConfig({ ...config, host: e.target.value })}
                      placeholder="127.0.0.1"
                      className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 outline-none focus:border-primary-500"
                    />
                  </div>
                  <div className="w-24">
                    <label className="mb-1 block text-sm text-gray-400">Port</label>
                    <input
                      type="number"
                      value={config.port}
                      onChange={(e) => setConfig({ ...config, port: Number(e.target.value) })}
                      className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white outline-none focus:border-primary-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-sm text-gray-400">Username (optional)</label>
                  <input
                    type="text"
                    value={config.username}
                    onChange={(e) => setConfig({ ...config, username: e.target.value })}
                    className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 outline-none focus:border-primary-500"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm text-gray-400">Password (optional)</label>
                  <input
                    type="password"
                    value={config.password}
                    onChange={(e) => setConfig({ ...config, password: e.target.value })}
                    className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 outline-none focus:border-primary-500"
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
                className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-200 transition-colors hover:border-primary-500 hover:text-primary-400 disabled:opacity-50"
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

          <div className="mt-6 flex justify-end gap-3">
            <button
              onClick={onClose}
              className="rounded-lg border border-gray-700 bg-transparent px-4 py-2 text-sm font-medium text-gray-200 transition-colors hover:bg-gray-800"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="rounded-lg bg-primary-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-600 disabled:opacity-50"
            >
              {saved ? 'Saved!' : saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

export function LoginPage() {
  const { login, register, isConfigured, configError } = useAuth();
  const [isRegistering, setIsRegistering] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showProxy, setShowProxy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!isConfigured) {
      setError('Application is not configured. Please contact administrator.');
      return;
    }

    if (isRegistering && password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setIsLoading(true);
    try {
      if (isRegistering) {
        await register(email, password);
      } else {
        await login(email, password);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-950 p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="mb-2 text-3xl font-bold text-white">Magic Term</h1>
          <p className="text-gray-400">Secure SSH client with E2E encryption</p>
        </div>

        {configError && (
          <div className="mb-6 rounded-xl bg-red-500/10 border border-red-500/20 p-4">
            <h3 className="font-medium text-red-400 mb-2">Configuration Error</h3>
            <p className="text-sm text-red-300">{configError}</p>
            <p className="text-xs text-gray-500 mt-2">
              Make sure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set in the build.
            </p>
          </div>
        )}

        <div className="rounded-xl bg-gray-900 p-6 shadow-xl">
          <h2 className="mb-6 text-xl font-semibold text-white">
            {isRegistering ? 'Create Account' : 'Sign In'}
          </h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              type="email"
              label="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              disabled={!isConfigured}
            />

            <Input
              type="password"
              label="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              minLength={6}
              disabled={!isConfigured}
            />

            {isRegistering && (
              <Input
                type="password"
                label="Confirm Password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                required
                minLength={6}
                disabled={!isConfigured}
              />
            )}

            {error && (
              <div className="rounded-lg bg-red-500/10 p-3 text-sm text-red-400">
                {error}
              </div>
            )}

            <Button type="submit" className="w-full" disabled={isLoading || !isConfigured}>
              {isLoading
                ? 'Loading...'
                : isRegistering
                ? 'Create Account'
                : 'Sign In'}
            </Button>
          </form>

          <div className="mt-6 text-center">
            <button
              type="button"
              onClick={() => {
                setIsRegistering(!isRegistering);
                setError('');
              }}
              className="text-sm text-primary-400 hover:text-primary-300"
              disabled={!isConfigured}
            >
              {isRegistering
                ? 'Already have an account? Sign in'
                : "Don't have an account? Register"}
            </button>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <p className="text-xs text-gray-500">
            Your credentials are encrypted locally before sync
          </p>
          <button
            type="button"
            onClick={() => setShowProxy(true)}
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
            title="Proxy Settings"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </div>
      </div>

      <ProxySettingsModal isOpen={showProxy} onClose={() => setShowProxy(false)} />
    </div>
  );
}
