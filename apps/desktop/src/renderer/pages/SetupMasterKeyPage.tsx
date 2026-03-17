import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';

export function SetupMasterKeyPage() {
  const { setupMasterKey, unlockWithMasterKey, needsMasterKeySetup } = useAuth();
  const [masterPassword, setMasterPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const isSetup = needsMasterKeySetup;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (isSetup && masterPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (masterPassword.length < 8) {
      setError('Master password must be at least 8 characters');
      return;
    }

    setIsLoading(true);
    try {
      if (isSetup) {
        await setupMasterKey(masterPassword);
      } else {
        const success = await unlockWithMasterKey(masterPassword);
        if (!success) {
          setError('Invalid master password');
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set master password');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-950 p-4">
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
          <h1 className="mb-2 text-2xl font-bold text-white">
            {isSetup ? 'Set Master Password' : 'Unlock Vault'}
          </h1>
          <p className="text-gray-400">
            {isSetup
              ? 'This password encrypts your server credentials locally'
              : 'Enter your master password to decrypt your credentials'}
          </p>
        </div>

        <div className="rounded-xl bg-gray-900 p-6 shadow-xl">
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              type="password"
              label="Master Password"
              value={masterPassword}
              onChange={(e) => setMasterPassword(e.target.value)}
              placeholder="••••••••"
              required
              minLength={8}
              autoFocus
            />

            {isSetup && (
              <Input
                type="password"
                label="Confirm Master Password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                required
                minLength={8}
              />
            )}

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
