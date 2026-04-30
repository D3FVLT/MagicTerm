import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import {
  initSupabase,
  signIn,
  signUp,
  signOut,
  getSession,
  getUser,
  onAuthStateChange,
  getMasterKeyVerifier,
  setMasterKeyVerifier as setMasterKeyVerifierInSupabase,
  getUserProfile,
  type User,
  type Session,
} from '@magicterm/supabase-client';
import { cryptoManager } from '@magicterm/crypto';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

// Initialize Supabase once at module level to avoid multiple instances. We
// hand the client a custom storage adapter that proxies through Electron's
// safeStorage (via IPC). This stops the refresh token from sitting in
// localStorage as plain JSON where any renderer-side script can read it.
const supabaseStorage = {
  getItem: async (key: string) => {
    try {
      const result = await window.electronAPI.secureStorage.get(key);
      return result.success ? result.value : null;
    } catch {
      return null;
    }
  },
  setItem: async (key: string, value: string) => {
    try {
      await window.electronAPI.secureStorage.set(key, value);
    } catch {
      // Swallow: if the OS keychain is unavailable we accept that the
      // session won't persist across launches rather than crashing.
    }
  },
  removeItem: async (key: string) => {
    try {
      await window.electronAPI.secureStorage.remove(key);
    } catch {
      // Ignore
    }
  },
};

let supabaseInitialized = false;
if (isSupabaseConfigured && !supabaseInitialized) {
  try {
    initSupabase(SUPABASE_URL, SUPABASE_ANON_KEY, {
      storage: supabaseStorage,
      storageKey: 'magicterm.supabase.auth',
    });
    supabaseInitialized = true;
  } catch (err) {
    console.error('Failed to initialize Supabase:', err);
  }
}

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  hasMasterKey: boolean;
  needsMasterKeySetup: boolean;
  isConfigured: boolean;
  configError: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setupMasterKey: (masterPassword: string) => Promise<void>;
  unlockWithMasterKey: (masterPassword: string) => Promise<boolean>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasMasterKey, setHasMasterKey] = useState(false);
  // Renderer no longer caches the verifier itself; it only tracks whether
  // a verifier exists somewhere (local store, cloud sync, or main cache).
  const [hasVerifier, setHasVerifier] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabaseInitialized) {
      console.error('Supabase not configured. VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are required.');
      setConfigError('Supabase is not configured. Please check environment variables.');
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    async function initialize() {
      try {
        const currentSession = await getSession();
        if (cancelled) return;
        
        const currentUser = await getUser();
        if (cancelled) return;

        setSession(currentSession);
        setUser(currentUser);

        // Local availability check first — main process knows whether it has
        // a verifier cached (from prior session) without leaking the value.
        try {
          const authStatus = await window.electronAPI.auth.getStatus();
          if (!cancelled && authStatus.hasMasterKey) {
            setHasVerifier(true);
          }
        } catch {
          // Ignore local storage errors
        }

        // Cloud sync: pull the verifier and immediately hand it to main.
        // The renderer only retains the boolean "verifier exists" flag.
        if (currentUser && !cancelled) {
          try {
            const cloudVerifier = await getMasterKeyVerifier();
            if (cancelled) return;

            if (cloudVerifier) {
              await window.electronAPI.masterKey.setVerifier(cloudVerifier);
              setHasVerifier(true);
            }
          } catch {
            // Cloud sync is optional; main process verifier (if any) still
            // lets the user unlock locally. Avoid logging the error body
            // since it can leak Supabase request details.
          }
        }
      } catch (error) {
        console.error('Failed to initialize auth');
        void error;
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    initialize();

    const { data } = onAuthStateChange((event, newSession) => {
      if (cancelled) return;
      
      setSession(newSession);
      setUser(newSession?.user ?? null);
      
      // When user signs out, clear master key
      if (event === 'SIGNED_OUT') {
        setHasVerifier(false);
        setHasMasterKey(false);
        cryptoManager.clearMasterPassword();
        window.electronAPI.masterKey.setVerifier(null).catch(() => {});
      }
    });

    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
    };
  }, []);

  const login = async (email: string, password: string) => {
    if (!isSupabaseConfigured) {
      throw new Error('Supabase is not configured');
    }
    const { session: newSession, user: newUser } = await signIn(email, password);
    setSession(newSession);
    setUser(newUser);

    try {
      const authStatus = await window.electronAPI.auth.getStatus();
      if (authStatus.hasMasterKey) {
        setHasVerifier(true);
      }
    } catch {
      // Ignore
    }

    if (newUser) {
      try {
        const cloudVerifier = await getMasterKeyVerifier();
        if (cloudVerifier) {
          await window.electronAPI.masterKey.setVerifier(cloudVerifier);
          setHasVerifier(true);
        }
      } catch {
        // Cloud sync optional, see comment in initialize().
      }
    }
  };

  const register = async (email: string, password: string) => {
    if (!isSupabaseConfigured) {
      throw new Error('Supabase is not configured');
    }
    const { session: newSession, user: newUser } = await signUp(email, password);
    setSession(newSession);
    setUser(newUser ?? null);
  };

  const logout = async () => {
    if (isSupabaseConfigured) {
      await signOut();
    }
    await window.electronAPI.auth.logout();
    await window.electronAPI.masterKey.setVerifier(null).catch(() => {});
    cryptoManager.clearMasterPassword();
    setSession(null);
    setUser(null);
    setHasMasterKey(false);
    setHasVerifier(false);
  };

  const setupMasterKey = async (masterPassword: string) => {
    // Hash on main with scrypt; renderer never sees a fast SHA-256 digest
    // that could be brute-forced offline.
    const result = await window.electronAPI.masterKey.createVerifier(masterPassword);
    if (!result.success || !result.verifier) {
      throw new Error(result.error || 'Failed to derive master key verifier');
    }

    // Sync the strong verifier to Supabase so other devices benefit. It is
    // safe to send: it is salted + scrypt and useless without a working
    // brute-force budget.
    await setMasterKeyVerifierInSupabase(result.verifier);

    cryptoManager.setMasterPassword(masterPassword);
    setHasVerifier(true);
    setHasMasterKey(true);
  };

  const unlockWithMasterKey = async (masterPassword: string): Promise<boolean> => {
    if (!hasVerifier) return false;

    const result = await window.electronAPI.masterKey.verify(masterPassword);
    if (!result.success || !result.valid) {
      return false;
    }

    cryptoManager.setMasterPassword(masterPassword);
    setHasMasterKey(true);

    // Transparent migration:
    //   - Path A (main upgraded a legacy SHA-256 row to scrypt locally): mirror
    //     the new strong verifier into the cloud sync row.
    //   - Path B (cloud profile still has a scrypt verifier in the legacy
    //     master_key_hash column, written by an earlier build): move it into
    //     master_key_verifier so the legacy column can finally be retired.
    // Both paths are idempotent — once master_key_verifier is set and the
    // legacy column is null, neither branch fires again.
    if (result.upgraded && result.verifier) {
      try {
        await setMasterKeyVerifierInSupabase(result.verifier);
      } catch {
        // Best-effort; main has the strong verifier locally regardless.
      }
    } else {
      try {
        const profile = await getUserProfile();
        if (
          profile &&
          !profile.masterKeyVerifier &&
          profile.masterKeyHash &&
          profile.masterKeyHash.startsWith('scrypt$')
        ) {
          await setMasterKeyVerifierInSupabase(profile.masterKeyHash);
        }
      } catch {
        // Cloud realignment is best-effort.
      }
    }

    return true;
  };

  const value: AuthContextValue = {
    user,
    session,
    isAuthenticated: !!session,
    isLoading,
    hasMasterKey,
    needsMasterKeySetup: !!session && !hasVerifier,
    isConfigured: isSupabaseConfigured,
    configError,
    login,
    register,
    logout,
    setupMasterKey,
    unlockWithMasterKey,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
