import { createContext, useContext, useState, useCallback, useRef, ReactNode } from 'react';
import type { HostKeyChallenge } from '../types/electron';
import { HostKeyDialog } from '../components/HostKeyDialog';

interface PendingChallenge {
  challenge: HostKeyChallenge;
  resolve: (trusted: boolean) => void;
}

interface HostKeyContextValue {
  /**
   * Show the host-key verification dialog and wait for the user to either
   * trust the fingerprint (resolves to `true` and persists the trust entry)
   * or cancel (resolves to `false`). Used by the connect flow when the
   * main process returns `host_key_unknown` or `host_key_mismatch`.
   */
  verifyHostKey: (challenge: HostKeyChallenge) => Promise<boolean>;
}

const HostKeyContext = createContext<HostKeyContextValue | null>(null);

export function useHostKey(): HostKeyContextValue {
  const ctx = useContext(HostKeyContext);
  if (!ctx) {
    throw new Error('useHostKey must be used within HostKeyProvider');
  }
  return ctx;
}

export function HostKeyProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingChallenge | null>(null);
  const pendingRef = useRef<PendingChallenge | null>(null);

  const verifyHostKey = useCallback((challenge: HostKeyChallenge): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      const next: PendingChallenge = { challenge, resolve };
      pendingRef.current = next;
      setPending(next);
    });
  }, []);

  const respond = useCallback(async (trusted: boolean) => {
    const current = pendingRef.current;
    if (!current) return;
    pendingRef.current = null;
    setPending(null);
    if (trusted) {
      const { host, port, fingerprint } = current.challenge;
      try {
        await window.electronAPI.sshHostKeys.trust(host, port, fingerprint);
      } catch {
        // If the trust write fails we still resolve true — the user said
        // yes, the worst case is the next connect prompts again.
      }
    }
    current.resolve(trusted);
  }, []);

  return (
    <HostKeyContext.Provider value={{ verifyHostKey }}>
      {children}
      <HostKeyDialog
        challenge={pending?.challenge ?? null}
        onTrust={() => void respond(true)}
        onCancel={() => void respond(false)}
      />
    </HostKeyContext.Provider>
  );
}
