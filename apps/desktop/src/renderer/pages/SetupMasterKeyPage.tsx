import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { MASTER_PASSWORD_MIN_LENGTH } from '@magicterm/shared';

export function SetupMasterKeyPage() {
  const { setupMasterKey, unlockWithMasterKey, needsMasterKeySetup } = useAuth();
  const [masterPassword, setMasterPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [rememberPassword, setRememberPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isAutoUnlocking, setIsAutoUnlocking] = useState(false);

  const isSetup = needsMasterKeySetup;

  useEffect(() => {
    if (isSetup) return;
    let cancelled = false;
    setIsAutoUnlocking(true);
    window.electronAPI.masterPassword.get().then(async (result) => {
      if (cancelled) return;
      if (result.success && result.password) {
        const ok = await unlockWithMasterKey(result.password);
        if (!ok && !cancelled) {
          await window.electronAPI.masterPassword.clear();
          setIsAutoUnlocking(false);
        }
      } else {
        setIsAutoUnlocking(false);
      }
    }).catch(() => {
      if (!cancelled) setIsAutoUnlocking(false);
    });
    return () => { cancelled = true; };
  }, [isSetup, unlockWithMasterKey]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (isSetup && masterPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    // Length policy only applies when CREATING a new master password. Existing
    // users from before the policy bump may still have shorter passwords; the
    // verifier check is what actually gates them in.
    if (isSetup && masterPassword.length < MASTER_PASSWORD_MIN_LENGTH) {
      setError(`Master password must be at least ${MASTER_PASSWORD_MIN_LENGTH} characters`);
      return;
    }

    setIsLoading(true);
    try {
      if (isSetup) {
        await setupMasterKey(masterPassword);
        if (rememberPassword) {
          await window.electronAPI.masterPassword.save(masterPassword);
        }
      } else {
        const success = await unlockWithMasterKey(masterPassword);
        if (!success) {
          setError('Invalid master password');
        } else if (rememberPassword) {
          await window.electronAPI.masterPassword.save(masterPassword);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set master password');
    } finally {
      setIsLoading(false);
    }
  };

  if (isAutoUnlocking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-app p-4">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary-500 border-t-transparent" />
          <span className="text-fg-muted">Unlocking vault...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-app p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary-500/10">
            <svg
              className="h-8 w-8 text-primary-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
              />
            </svg>
          </div>
          <h1 className="mb-2 text-2xl font-bold text-fg">
            {isSetup ? 'Set Master Password' : 'Unlock Vault'}
          </h1>
          <p className="text-fg-muted">
            {isSetup
              ? 'This password encrypts your server credentials locally'
              : 'Enter your master password to decrypt your credentials'}
          </p>
        </div>

        <div className="rounded-xl bg-surface-1 p-6 shadow-xl">
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              type="password"
              label="Master Password"
              value={masterPassword}
              onChange={(e) => setMasterPassword(e.target.value)}
              placeholder="••••••••••••"
              required
              minLength={isSetup ? MASTER_PASSWORD_MIN_LENGTH : 1}
              autoFocus
            />

            {isSetup && (
              <Input
                type="password"
                label="Confirm Master Password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••••••"
                required
                minLength={MASTER_PASSWORD_MIN_LENGTH}
              />
            )}

            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={rememberPassword}
                onChange={(e) => setRememberPassword(e.target.checked)}
                className="h-4 w-4 rounded border-edge-strong bg-surface-2 text-primary-500 focus:ring-primary-500 focus:ring-offset-0"
              />
              <span className="text-sm text-fg-muted">Remember on this device</span>
            </label>

            {error && (
              <div className="rounded-lg bg-red-500/10 p-3 text-sm text-red-400">
                {error}
              </div>
            )}

            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? 'Processing...' : isSetup ? 'Set Master Password' : 'Unlock'}
            </Button>
          </form>
        </div>

        {isSetup && (
          <div className="mt-4 rounded-lg bg-yellow-500/10 p-4 text-sm text-yellow-400">
            <strong>Important:</strong> This password cannot be recovered. If you forget
            it, you will need to re-add all your servers.
          </div>
        )}
      </div>
    </div>
  );
}
