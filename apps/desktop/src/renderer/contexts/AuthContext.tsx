import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import {
  initSupabase,
  signIn,
  signUp,
  signOut,
  getSession,
  getUser,
  onAuthStateChange,
  type User,
  type Session,
} from '@magicterm/supabase-client';
import { hashPassword, verifyPasswordHash, cryptoManager } from '@magicterm/crypto';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  hasMasterKey: boolean;
  needsMasterKeySetup: boolean;
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
  const [masterKeyHash, setMasterKeyHash] = useState<string | null>(null);

  useEffect(() => {
    if (SUPABASE_URL && SUPABASE_ANON_KEY) {
      initSupabase(SUPABASE_URL, SUPABASE_ANON_KEY);
    }

    async function initialize() {
      try {
        const authStatus = await window.electronAPI.auth.getStatus();
        setMasterKeyHash(authStatus.masterKeyHash || null);

        if (SUPABASE_URL && SUPABASE_ANON_KEY) {
          const currentSession = await getSession();
          const currentUser = await getUser();
          setSession(currentSession);
          setUser(currentUser);
        }
      } catch (error) {
        console.error('Failed to initialize auth:', error);
      } finally {
        setIsLoading(false);
      }
    }

    initialize();

    if (SUPABASE_URL && SUPABASE_ANON_KEY) {
      const { data } = onAuthStateChange((_event, newSession) => {
        setSession(newSession);
        setUser(newSession?.user ?? null);
      });

      return () => {
        data.subscription.unsubscribe();
      };
    }
  }, []);

  const login = async (email: string, password: string) => {
    const { session: newSession, user: newUser } = await signIn(email, password);
    setSession(newSession);
    setUser(newUser);
  };

  const register = async (email: string, password: string) => {
    const { session: newSession, user: newUser } = await signUp(email, password);
    setSession(newSession);
    setUser(newUser ?? null);
  };

  const logout = async () => {
    await signOut();
    await window.electronAPI.auth.logout();
    cryptoManager.clearMasterPassword();
    setSession(null);
    setUser(null);
    setHasMasterKey(false);
    setMasterKeyHash(null);
  };

  const setupMasterKey = async (masterPassword: string) => {
    const hash = await hashPassword(masterPassword);
    await window.electronAPI.auth.setMasterKeyHash(hash);
    cryptoManager.setMasterPassword(masterPassword);
    setMasterKeyHash(hash);
    setHasMasterKey(true);
  };

  const unlockWithMasterKey = async (masterPassword: string): Promise<boolean> => {
    if (!masterKeyHash) return false;

    const isValid = await verifyPasswordHash(masterPassword, masterKeyHash);
    if (isValid) {
      cryptoManager.setMasterPassword(masterPassword);
      setHasMasterKey(true);
      return true;
    }
    return false;
  };

  const value: AuthContextValue = {
    user,
    session,
    isAuthenticated: !!session,
    isLoading,
    hasMasterKey,
    needsMasterKeySetup: !!session && !masterKeyHash,
    login,
    register,
    logout,
    setupMasterKey,
    unlockWithMasterKey,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
