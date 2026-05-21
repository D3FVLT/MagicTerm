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
  requestPasswordReset as requestPasswordResetApi,
  deleteCurrentAccount,
  type User,
  type Session,
} from '@magicterm/supabase-client';
import { cryptoManager } from '@magicterm/crypto';

const WEB_BASE_URL = 'https://magicterm.app';
const EMAIL_CONFIRM_REDIRECT = `${WEB_BASE_URL}/auth/confirmed`;
const PASSWORD_RESET_REDIRECT = `${WEB_BASE_URL}/auth/reset-password`;

/** Detects auth errors that mean "your stored session is no longer valid" —
 *  e.g. the user was deleted from Supabase, or the JWT was rotated/revoked.
 *  In that case we don't want to silently sit on a useless session: we wipe
 *  it locally and bounce the user back to the login screen. */
function isStaleSessionError(error: unknown): boolean {
  if (!error) return false;
  const err = error as { code?: string; status?: number; message?: string };
  if (err.code === 'user_not_found') return true;
  if (err.status === 401 || err.status === 403) return true;
  const msg = (err.message ?? '').toLowerCase();
  return (
    msg.includes('user from sub claim') ||
    msg.includes('user not found') ||
    msg.includes('jwt expired') ||
    msg.includes('invalid refresh token') ||
    msg.includes('refresh token not found')
  );
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

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
    }
  },
  removeItem: async (key: string) => {
    try {
      await window.electronAPI.secureStorage.remove(key);
    } catch {
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

export interface RegisterResult {
  needsConfirmation: boolean;
  email: string;
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
  register: (email: string, password: string) => Promise<RegisterResult>;
  logout: () => Promise<void>;
  setupMasterKey: (masterPassword: string) => Promise<void>;
  unlockWithMasterKey: (masterPassword: string) => Promise<boolean>;
  requestPasswordReset: (email: string) => Promise<void>;
  deleteAccount: () => Promise<void>;
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

    async function clearLocalSession() {
      try { await signOut(); } catch { /* server may already be gone */ }
      try { await window.electronAPI.auth.logout(); } catch {}
      try { await window.electronAPI.masterKey.setVerifier(null); } catch {}
      try { await window.electronAPI.masterPassword.clear(); } catch {}
      cryptoManager.clearMasterPassword();
      setSession(null);
      setUser(null);
      setHasVerifier(false);
      setHasMasterKey(false);
    }

    async function initialize() {
      try {
        const currentSession = await getSession();
        if (cancelled) return;

        let currentUser: User | null = null;
        try {
          currentUser = await getUser();
        } catch (error) {
          if (isStaleSessionError(error)) {
            console.warn('[auth] Stored session is invalid (user deleted or JWT revoked); clearing.');
            await clearLocalSession();
            return;
          }
          throw error;
        }
        if (cancelled) return;

        setSession(currentSession);
        setUser(currentUser);

        try {
          const authStatus = await window.electronAPI.auth.getStatus();
          if (!cancelled && authStatus.hasMasterKey) {
            setHasVerifier(true);
          }
        } catch {
        }

        if (currentUser && !cancelled) {
          try {
            const cloudVerifier = await getMasterKeyVerifier();
            if (cancelled) return;

            if (cloudVerifier) {
              await window.electronAPI.masterKey.setVerifier(cloudVerifier);
              setHasVerifier(true);
            }
          } catch (error) {
            if (isStaleSessionError(error)) {
              console.warn('[auth] Profile fetch returned user_not_found; clearing local session.');
              await clearLocalSession();
              return;
            }
          }
        }
      } catch (error) {
        console.error('Failed to initialize auth', error);
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
    }

    if (newUser) {
      try {
        const cloudVerifier = await getMasterKeyVerifier();
        if (cloudVerifier) {
          await window.electronAPI.masterKey.setVerifier(cloudVerifier);
          setHasVerifier(true);
        }
      } catch {
      }
    }
  };

  const register = async (email: string, password: string): Promise<RegisterResult> => {
    if (!isSupabaseConfigured) {
      throw new Error('Supabase is not configured');
    }
    const { session: newSession, user: newUser } = await signUp(email, password, {
      emailRedirectTo: EMAIL_CONFIRM_REDIRECT,
    });
    setSession(newSession);
    setUser(newUser ?? null);
    return {
      needsConfirmation: !newSession,
      email,
    };
  };

  const logout = async () => {
    if (isSupabaseConfigured) {
      // signOut may fail if the server-side session is already gone
      // (e.g. user was deleted). We still want to wipe local state.
      try { await signOut(); } catch (err) {
        console.warn('[auth] signOut failed; proceeding with local logout', err);
      }
    }
    await window.electronAPI.auth.logout().catch(() => {});
    await window.electronAPI.masterKey.setVerifier(null).catch(() => {});
    await window.electronAPI.masterPassword.clear().catch(() => {});
    cryptoManager.clearMasterPassword();
    setSession(null);
    setUser(null);
    setHasMasterKey(false);
    setHasVerifier(false);
  };

  const requestPasswordReset = async (email: string) => {
    if (!isSupabaseConfigured) {
      throw new Error('Supabase is not configured');
    }
    await requestPasswordResetApi(email, PASSWORD_RESET_REDIRECT);
  };

  const deleteAccount = async () => {
    if (!isSupabaseConfigured) {
      throw new Error('Supabase is not configured');
    }
    await deleteCurrentAccount();
    // After the RPC succeeds the auth row is gone; the supabase client may
    // still hold a refresh token that's now invalid, so we tear it all down
    // locally and don't trust signOut() to succeed.
    try { await signOut(); } catch { /* expected to fail */ }
    await window.electronAPI.auth.logout().catch(() => {});
    await window.electronAPI.masterKey.setVerifier(null).catch(() => {});
    await window.electronAPI.masterPassword.clear().catch(() => {});
    cryptoManager.clearMasterPassword();
    setSession(null);
    setUser(null);
    setHasMasterKey(false);
    setHasVerifier(false);
  };

  const setupMasterKey = async (masterPassword: string) => {
    const result = await window.electronAPI.masterKey.createVerifier(masterPassword);
    if (!result.success || !result.verifier) {
      throw new Error(result.error || 'Failed to derive master key verifier');
    }

    try {
      await setMasterKeyVerifierInSupabase(result.verifier);
    } catch (error) {
      if (isStaleSessionError(error)) {
        // Account was deleted (or JWT revoked) while we still had a stored
        // session. Don't leave the user trapped on this screen — wipe
        // everything and send them back to the login page.
        await logout();
        throw new Error(
          'Your account is no longer available on the server. Please sign in again or register a new one.'
        );
      }
      throw error;
    }

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

    if (result.upgraded && result.verifier) {
      try {
        await setMasterKeyVerifierInSupabase(result.verifier);
      } catch {
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
    requestPasswordReset,
    deleteAccount,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
