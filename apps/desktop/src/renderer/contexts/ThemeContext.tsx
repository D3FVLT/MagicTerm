import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  APP_THEMES,
  DEFAULT_APP_THEME_ID,
  isAppThemeId,
  type AppThemeMeta,
} from '../lib/app-themes';

interface ThemeContextValue {
  theme: AppThemeMeta;
  themeId: string;
  setTheme: (id: string) => void;
  themes: AppThemeMeta[];
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function applyThemeToDocument(id: string): void {
  const target = APP_THEMES[id] ?? APP_THEMES[DEFAULT_APP_THEME_ID];
  document.documentElement.dataset.theme = target.id;
  document.documentElement.style.colorScheme = target.isDark ? 'dark' : 'light';
}

interface ThemeProviderProps {
  children: ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [themeId, setThemeIdState] = useState<string>(DEFAULT_APP_THEME_ID);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await window.electronAPI.terminalSettings.get();
        if (cancelled || !result.success || !result.settings) return;
        const stored = (result.settings as { appThemeId?: unknown }).appThemeId;
        if (isAppThemeId(stored)) {
          setThemeIdState(stored);
          applyThemeToDocument(stored);
        }
      } catch {
      }
    })();
    applyThemeToDocument(DEFAULT_APP_THEME_ID);
    return () => {
      cancelled = true;
    };
  }, []);

  const setTheme = useCallback((id: string) => {
    const safe = isAppThemeId(id) ? id : DEFAULT_APP_THEME_ID;
    setThemeIdState(safe);
    applyThemeToDocument(safe);
    void (async () => {
      try {
        const current = await window.electronAPI.terminalSettings.get();
        const base =
          current.success && current.settings ? (current.settings as Record<string, unknown>) : {};
        await window.electronAPI.terminalSettings.set({ ...base, appThemeId: safe });
      } catch {
      }
    })();
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme: APP_THEMES[themeId] ?? APP_THEMES[DEFAULT_APP_THEME_ID],
      themeId,
      setTheme,
      themes: Object.values(APP_THEMES),
    }),
    [themeId, setTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useAppTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useAppTheme must be used inside <ThemeProvider>');
  }
  return ctx;
}
