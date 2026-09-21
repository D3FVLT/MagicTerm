export interface AppThemeMeta {
  id: string;
  name: string;
  description: string;
  defaultTerminalThemeId: string;
  isDark: boolean;
  preview: {
    bg: string;
    surface: string;
    accent: string;
    text: string;
  };
}

export const APP_THEMES: Record<string, AppThemeMeta> = {
  midnight: {
    id: 'midnight',
    name: 'Midnight',
    description: 'Dark, blue tint',
    defaultTerminalThemeId: 'tokyo-night',
    isDark: true,
    preview: {
      bg: '#1a1b26',
      surface: '#24283b',
      accent: '#7aa2f7',
      text: '#c0caf5',
    },
  },
  onyx: {
    id: 'onyx',
    name: 'Onyx',
    description: 'Black, high contrast',
    defaultTerminalThemeId: 'github-dark',
    isDark: true,
    preview: {
      bg: '#000000',
      surface: '#0d0d10',
      accent: '#f4f1ea',
      text: '#e6edf3',
    },
  },
  daylight: {
    id: 'daylight',
    name: 'Daylight',
    description: 'Light',
    defaultTerminalThemeId: 'github-light',
    isDark: false,
    preview: {
      bg: '#ffffff',
      surface: '#f5f6f8',
      accent: '#0969da',
      text: '#1f2328',
    },
  },
};

export const DEFAULT_APP_THEME_ID = 'midnight';

export function isAppThemeId(value: unknown): value is keyof typeof APP_THEMES {
  return typeof value === 'string' && value in APP_THEMES;
}
