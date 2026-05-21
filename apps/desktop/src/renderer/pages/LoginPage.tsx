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

type Mode = 'signin' | 'signup' | 'forgot';

export function LoginPage() {
  const { login, register, requestPasswordReset, isConfigured, configError } = useAuth();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showProxy, setShowProxy] = useState(false);
  const [pendingConfirmation, setPendingConfirmation] = useState<string | null>(null);
  const [resetSentTo, setResetSentTo] = useState<string | null>(null);

  const switchMode = (next: Mode) => {
    setMode(next);
    setError('');
    setConfirmPassword('');
    setPendingConfirmation(null);
    setResetSentTo(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!isConfigured) {
      setError('Application is not configured. Please contact administrator.');
      return;
    }

    if (mode === 'signup' && password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setIsLoading(true);
    try {
      if (mode === 'signup') {
        const result = await register(email, password);
        if (result.needsConfirmation) {
          setPendingConfirmation(result.email);
          setPassword('');
          setConfirmPassword('');
        }
      } else if (mode === 'forgot') {
        await requestPasswordReset(email);
        setResetSentTo(email);
      } else {
        await login(email, password);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setIsLoading(false);
    }
  };

  const title =
    mode === 'signup' ? 'Create Account' : mode === 'forgot' ? 'Reset Password' : 'Sign In';

  return (
    <div className="flex min-h-screen items-center justify-center bg-app p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="mb-2 text-3xl font-bold text-fg">Magic Term</h1>
          <p className="text-fg-muted">Secure SSH client with E2E encryption</p>
        </div>

        {configError && (
          <div className="mb-6 rounded-xl bg-red-500/10 border border-red-500/20 p-4">
            <h3 className="font-medium text-red-400 mb-2">Configuration Error</h3>
            <p className="text-sm text-red-300">{configError}</p>
            <p className="text-xs text-fg-subtle mt-2">
              Make sure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set in the build.
            </p>
          </div>
        )}

        {pendingConfirmation && (
          <div className="mb-6 rounded-xl border border-[var(--accent)]/30 bg-[var(--accent)]/10 p-4">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[var(--accent)]/20">
                <svg className="h-4 w-4 text-[var(--accent)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-medium text-fg">Check your inbox</h3>
                <p className="mt-1 text-sm text-fg-muted">
                  We sent a confirmation link to <span className="font-medium text-fg break-all">{pendingConfirmation}</span>.
                  Open it, then come back here to sign in.
                </p>
                <p className="mt-2 text-xs text-fg-subtle">
                  Didn't get it? Check your spam folder, or{' '}
                  <button
                    type="button"
                    onClick={() => switchMode('signup')}
                    className="text-[var(--accent)] hover:underline"
                  >
                    try again with a different email
                  </button>.
                </p>
              </div>
            </div>
          </div>
        )}

        {resetSentTo && (
          <div className="mb-6 rounded-xl border border-[var(--accent)]/30 bg-[var(--accent)]/10 p-4">
            <h3 className="font-medium text-fg">Reset email sent</h3>
            <p className="mt-1 text-sm text-fg-muted">
              If an account exists for <span className="font-medium text-fg break-all">{resetSentTo}</span>,
              we've sent a password reset link. Open it in your browser and follow the steps.
            </p>
          </div>
        )}

        <div className="rounded-xl bg-surface-1 p-6 shadow-xl">
          <h2 className="mb-6 text-xl font-semibold text-fg">{title}</h2>

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

            {mode !== 'forgot' && (
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
            )}

            {mode === 'signup' && (
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

            {mode === 'signin' && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => switchMode('forgot')}
                  className="text-xs text-fg-subtle hover:text-[var(--accent)] transition-colors"
                  disabled={!isConfigured}
                >
                  Forgot password?
                </button>
              </div>
            )}

            {error && (
              <div className="rounded-lg bg-red-500/10 p-3 text-sm text-red-400">
                {error}
              </div>
            )}

            <Button type="submit" className="w-full" disabled={isLoading || !isConfigured}>
              {isLoading
                ? 'Loading...'
                : mode === 'signup'
                ? 'Create Account'
                : mode === 'forgot'
                ? 'Send reset link'
                : 'Sign In'}
            </Button>
          </form>

          <div className="mt-6 text-center">
            {mode === 'signin' && (
              <button
                type="button"
                onClick={() => switchMode('signup')}
                className="text-sm text-[var(--accent)] hover:opacity-80"
                disabled={!isConfigured}
              >
                Don't have an account? Register
              </button>
            )}
            {mode === 'signup' && (
              <button
                type="button"
                onClick={() => switchMode('signin')}
                className="text-sm text-[var(--accent)] hover:opacity-80"
                disabled={!isConfigured}
              >
                Already have an account? Sign in
              </button>
            )}
            {mode === 'forgot' && (
              <button
                type="button"
                onClick={() => switchMode('signin')}
                className="text-sm text-[var(--accent)] hover:opacity-80"
                disabled={!isConfigured}
              >
                Back to sign in
              </button>
            )}
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <p className="text-xs text-fg-subtle">
            Your credentials are encrypted locally before sync
          </p>
          <button
            type="button"
            onClick={() => setShowProxy(true)}
            className="text-xs text-fg-subtle hover:text-fg-muted transition-colors"
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
