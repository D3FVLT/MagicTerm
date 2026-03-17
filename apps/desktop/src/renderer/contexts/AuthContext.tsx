import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import {
  initSupabase,
  signIn,
  signUp,
  signOut,
  getSession,
  getUser,
  onAuthStateChange,
  getMasterKeyHash,
  setMasterKeyHash as setMasterKeyHashInSupabase,
  type User,
  type Session,
} from '@magicterm/supabase-client';
import { hashPassword, verifyPasswordHash, cryptoManager } from '@magicterm/crypto';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

// Initialize Supabase once at module level to avoid multiple instances
let supabaseInitialized = false;
if (isSupabaseConfigured && !supabaseInitialized) {
  try {
    initSupabase(SUPABASE_URL, SUPABASE_ANON_KEY);
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
  const [masterKeyHash, setMasterKeyHash] = useState<string | null>(null);
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

        // Always try local storage first (fast and reliable)
        try {
          const authStatus = await window.electronAPI.auth.getStatus();
          if (!cancelled && authStatus.masterKeyHash) {
            setMasterKeyHash(authStatus.masterKeyHash);
          }
        } catch {
          // Ignore local storage errors
        }

        // Then try cloud sync (if table exists)
        if (currentUser && !cancelled) {
          try {
            const cloudHash = await getMasterKeyHash();
            if (cancelled) return;
            
            if (cloudHash) {
              setMasterKeyHash(cloudHash);
              // Update local cache
              await window.electronAPI.auth.setMasterKeyHash(cloudHash);
            }
          } catch (cloudError) {
            // Cloud sync failed - this is OK, table might not exist yet
            console.warn('Cloud master key sync not available:', cloudError);
          }
        }
      } catch (error) {
        console.error('Failed to initialize auth:', error);
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
        setMasterKeyHash(null);
        setHasMasterKey(false);
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
    
    // Try local storage first
    try {
      const authStatus = await window.electronAPI.auth.getStatus();
      if (authStatus.masterKeyHash) {
        setMasterKeyHash(authStatus.masterKeyHash);
      }
    } catch {
      // Ignore
    }
    
    // Then try cloud sync
    if (newUser) {
      try {
        const cloudHash = await getMasterKeyHash();
        if (cloudHash) {
          setMasterKeyHash(cloudHash);
          await window.electronAPI.auth.setMasterKeyHash(cloudHash);
        }
      } catch (error) {
        console.warn('Cloud master key sync not available:', error);
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
    cryptoManager.clearMasterPassword();
    setSession(null);
    setUser(null);
    setHasMasterKey(false);
    setMasterKeyHash(null);
  };

  const setupMasterKey = async (masterPassword: string) => {
    const hash = await hashPassword(masterPassword);
    
    // Save to Supabase (cloud sync)
    await setMasterKeyHashInSupabase(hash);
    
    // Also save locally for offline access
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
