import { useState, useEffect } from 'react';
import { Modal } from './ui/Modal';
import { Input } from './ui/Input';
import { Button } from './ui/Button';
import { Select } from './ui/Select';
import { useOrganizations } from '../contexts/OrganizationsContext';
import { useAppTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import {
  getUserSettings,
  updateUserSettings,
  getAccountDeletionPreview,
  type AccountDeletionPreview,
} from '@magicterm/supabase-client';
import type { UserSettings } from '@magicterm/shared';
import {
  TERMINAL_THEMES,
  FONT_OPTIONS,
  DEFAULT_TERMINAL_SETTINGS,
  type TerminalSettings,
} from '../lib/terminal-themes';
import { APP_THEMES } from '../lib/app-themes';

const DONATE_URL = 'https://www.donationalerts.com/r/whitenobel';
const GITHUB_URL = 'https://github.com/D3FVLT/MagicTerm';
const WEBSITE_URL = 'https://magicterm.app';
const APP_VERSION = '0.5.2';

interface ProxyConfig {
  enabled: boolean;
  type: 'http' | 'socks5';
  host: string;
  port: number;
  username: string;
  password: string;
}

const DEFAULT_PROXY: ProxyConfig = {
  enabled: false,
  type: 'http',
  host: '',
  port: 8080,
  username: '',
  password: '',
};

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const { organizations } = useOrganizations();
  const { themeId: appThemeId, setTheme: setAppTheme, themes: appThemes } = useAppTheme();
  const { user, deleteAccount } = useAuth();
  const [settings, setSettings] = useState<UserSettings>({ nickname: null, defaultOrgId: null });
  const [proxyConfig, setProxyConfig] = useState<ProxyConfig>(DEFAULT_PROXY);
  const [termSettings, setTermSettings] = useState<TerminalSettings>(DEFAULT_TERMINAL_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [proxyTestResult, setProxyTestResult] = useState<{ status: 'idle' | 'testing' | 'ok' | 'fail'; message?: string }>({ status: 'idle' });
  const [activeTab, setActiveTab] = useState<'general' | 'appearance' | 'terminal' | 'proxy' | 'account'>('general');
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletePreview, setDeletePreview] = useState<AccountDeletionPreview | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);

  useEffect(() => {
    if (!isOpen || activeTab !== 'account') return;
    let cancelled = false;
    setIsLoadingPreview(true);
    getAccountDeletionPreview()
      .then((p) => {
        if (!cancelled) setDeletePreview(p);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setIsLoadingPreview(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, activeTab]);

  useEffect(() => {
    if (!isOpen) return;

    const loadSettings = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const [userSettings, proxyResult, termResult] = await Promise.all([
          getUserSettings(),
          window.electronAPI.proxy.get(),
          window.electronAPI.terminalSettings.get(),
        ]);
        setSettings(userSettings);
        if (proxyResult.success && proxyResult.config) {
          setProxyConfig({ ...DEFAULT_PROXY, ...proxyResult.config, type: (proxyResult.config.type === 'socks5' ? 'socks5' : 'http') as ProxyConfig['type'] });
        }
        if (termResult.success && termResult.settings) {
          setTermSettings({ ...DEFAULT_TERMINAL_SETTINGS, ...termResult.settings as Partial<TerminalSettings> });
        }
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setIsLoading(false);
      }
    };

    loadSettings();
  }, [isOpen]);

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    setSuccess(false);
    try {
      await Promise.all([
        updateUserSettings(settings),
        window.electronAPI.proxy.set(proxyConfig),
        window.electronAPI.terminalSettings.set({
          ...(termSettings as unknown as Record<string, unknown>),
          appThemeId,
        }),
      ]);
      window.dispatchEvent(new Event('terminal-settings-changed'));
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const workspaceOptions = [
    { value: '', label: 'Personal (default)' },
    ...organizations.map((org) => ({ value: org.id, label: org.name })),
  ];

  const currentTheme = TERMINAL_THEMES[termSettings.themeId] || TERMINAL_THEMES['tokyo-night'];

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Settings">
      <div className="space-y-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
          </div>
        ) : (
          <>
            <div className="flex gap-1 border-b border-[var(--border)]">
              {(['general', 'appearance', 'terminal', 'proxy', 'account'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-3 py-2 text-xs font-medium capitalize transition-colors ${
                    activeTab === tab
                      ? 'border-b-2 border-[var(--accent)] text-[var(--accent)]'
                      : 'text-[var(--fg-subtle)] hover:text-[var(--fg-muted)]'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>

            {activeTab === 'general' && (
              <div className="space-y-6">
                <div>
                  <h3 className="mb-4 text-sm font-medium text-[var(--fg)]">Profile</h3>
                  <div className="space-y-4">
                    <div>
                      <label className="mb-1.5 block text-sm text-[var(--fg-muted)]">Nickname</label>
                      <Input
                        value={settings.nickname || ''}
                        onChange={(e) => setSettings({ ...settings, nickname: e.target.value })}
                        placeholder="Enter your nickname (shown instead of email)"
                      />
                      <p className="mt-1 text-xs text-[var(--fg-subtle)]">
                        Your nickname will be displayed to other team members instead of your email address.
                      </p>
                    </div>
                  </div>
                </div>
                <div className="border-t border-[var(--border)] pt-6">
                  <h3 className="mb-4 text-sm font-medium text-[var(--fg)]">Workspace</h3>
                  <div className="space-y-4">
                    <div>
                      <label className="mb-1.5 block text-sm text-[var(--fg-muted)]">Default Workspace</label>
                      <Select
                        value={settings.defaultOrgId || ''}
                        onChange={(e) => setSettings({ ...settings, defaultOrgId: e.target.value || null })}
                        options={workspaceOptions}
                      />
                      <p className="mt-1 text-xs text-[var(--fg-subtle)]">
                        This workspace will be selected automatically when you open the app.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'appearance' && (
              <div className="space-y-5">
                <div>
                  <label className="mb-1.5 block text-sm text-[var(--fg-muted)]">App theme</label>
                  <p className="mb-3 text-xs text-[var(--fg-subtle)]">
                    Switching the app theme also updates the terminal palette to a paired theme. You can override the terminal theme separately below.
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    {appThemes.map((t) => {
                      const isActive = appThemeId === t.id;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => {
                            setAppTheme(t.id);
                            const previousAppTheme = APP_THEMES[appThemeId];
                            const shouldFollowTerminal =
                              previousAppTheme &&
                              termSettings.themeId === previousAppTheme.defaultTerminalThemeId;
                            setTermSettings((prev) => ({
                              ...prev,
                              appThemeId: t.id,
                              themeId: shouldFollowTerminal ? t.defaultTerminalThemeId : prev.themeId,
                            }));
                            if (shouldFollowTerminal) {
                              window.dispatchEvent(new Event('terminal-settings-changed'));
                            }
                          }}
                          className={`flex flex-col gap-2 rounded-lg border p-3 text-left transition-colors ${
                            isActive
                              ? 'border-[var(--accent)] bg-[var(--accent)]/10'
                              : 'border-[var(--border)] hover:border-[var(--border-strong)]'
                          }`}
                        >
                          <div
                            className="flex h-10 overflow-hidden rounded"
                            style={{ backgroundColor: t.preview.bg }}
                          >
                            <div className="flex-1" style={{ backgroundColor: t.preview.surface }} />
                            <div className="flex-1" style={{ backgroundColor: t.preview.bg }} />
                            <div
                              className="w-1.5 self-center mx-1 h-5 rounded-sm"
                              style={{ backgroundColor: t.preview.accent }}
                            />
                            <div
                              className="flex-1 self-center text-[10px] font-mono px-1"
                              style={{ color: t.preview.text }}
                            >
                              Aa
                            </div>
                          </div>
                          <div>
                            <div className="text-sm font-medium text-[var(--fg)]">{t.name}</div>
                            <div className="text-xs text-[var(--fg-subtle)]">{t.description}</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'terminal' && (
              <div className="space-y-5">
                <div>
                  <label className="mb-1.5 block text-sm text-[var(--fg-muted)]">Theme</label>
                  <div className="grid grid-cols-2 gap-2">
                    {Object.entries(TERMINAL_THEMES).map(([id, theme]) => (
                      <button
                        key={id}
                        onClick={() => setTermSettings({ ...termSettings, themeId: id })}
                        className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                          termSettings.themeId === id
                            ? 'border-[var(--accent)] bg-[var(--accent)]/10'
                            : 'border-[var(--border)] hover:border-[var(--border-strong)]'
                        }`}
                      >
                        <div className="flex gap-0.5">
                          {[theme.red, theme.green, theme.yellow, theme.blue, theme.magenta, theme.cyan].map((c, i) => (
                            <div key={i} className="h-3 w-3 rounded-sm" style={{ backgroundColor: c }} />
                          ))}
                        </div>
                        <span className="text-[var(--fg)] truncate">{theme.name}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div
                  className="overflow-hidden rounded-lg border border-[var(--border)] p-3 font-mono text-xs leading-relaxed"
                  style={{
                    backgroundColor: currentTheme.background,
                    color: currentTheme.foreground,
                    fontFamily: termSettings.fontFamily,
                    fontSize: `${Math.min(termSettings.fontSize, 14)}px`,
                    lineHeight: termSettings.lineHeight,
                  }}
                >
                  <div>
                    <span style={{ color: currentTheme.green }}>user</span>
                    <span style={{ color: currentTheme.foreground }}>@</span>
                    <span style={{ color: currentTheme.blue }}>server</span>
                    <span style={{ color: currentTheme.foreground }}>:</span>
                    <span style={{ color: currentTheme.cyan }}>~</span>
                    <span style={{ color: currentTheme.foreground }}>$ </span>
                    <span style={{ color: currentTheme.yellow }}>ls</span>
                    <span style={{ color: currentTheme.foreground }}> -la</span>
                  </div>
                  <div>
                    <span style={{ color: currentTheme.blue }}>drwxr-xr-x</span>
                    <span style={{ color: currentTheme.foreground }}> 3 user user 4096 </span>
                    <span style={{ color: currentTheme.green }}>Documents</span>
                  </div>
                  <div>
                    <span style={{ color: currentTheme.red }}>-rw-r--r--</span>
                    <span style={{ color: currentTheme.foreground }}> 1 user user  512 </span>
                    <span style={{ color: currentTheme.magenta }}>config.yml</span>
                  </div>
                  <div>
                    <span style={{ color: currentTheme.green }}>user</span>
                    <span style={{ color: currentTheme.foreground }}>@</span>
                    <span style={{ color: currentTheme.blue }}>server</span>
                    <span style={{ color: currentTheme.foreground }}>:</span>
                    <span style={{ color: currentTheme.cyan }}>~</span>
                    <span style={{ color: currentTheme.foreground }}>$ </span>
                    <span
                      style={{
                        backgroundColor: currentTheme.cursor,
                        color: currentTheme.cursorAccent,
                      }}
                    >
                      &nbsp;
                    </span>
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-sm text-[var(--fg-muted)]">Font Family</label>
                  <select
                    value={termSettings.fontFamily}
                    onChange={(e) => setTermSettings({ ...termSettings, fontFamily: e.target.value })}
                    className="w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--fg)] outline-none focus:border-[var(--accent)]"
                  >
                    {FONT_OPTIONS.map((f) => (
                      <option key={f.label} value={f.value}>{f.label}</option>
                    ))}
                  </select>
                </div>

                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="mb-1.5 block text-sm text-[var(--fg-muted)]">Font Size</label>
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min={10}
                        max={24}
                        value={termSettings.fontSize}
                        onChange={(e) => setTermSettings({ ...termSettings, fontSize: Number(e.target.value) })}
                        className="flex-1 accent-[var(--accent)]"
                      />
                      <span className="w-8 text-center text-sm text-[var(--fg)]">{termSettings.fontSize}</span>
                    </div>
                  </div>
                  <div className="flex-1">
                    <label className="mb-1.5 block text-sm text-[var(--fg-muted)]">Line Height</label>
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min={10}
                        max={18}
                        value={Math.round(termSettings.lineHeight * 10)}
                        onChange={(e) => setTermSettings({ ...termSettings, lineHeight: Number(e.target.value) / 10 })}
                        className="flex-1 accent-[var(--accent)]"
                      />
                      <span className="w-8 text-center text-sm text-[var(--fg)]">{termSettings.lineHeight.toFixed(1)}</span>
                    </div>
                  </div>
                </div>

                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="mb-1.5 block text-sm text-[var(--fg-muted)]">Cursor Style</label>
                    <select
                      value={termSettings.cursorStyle}
                      onChange={(e) => setTermSettings({ ...termSettings, cursorStyle: e.target.value as TerminalSettings['cursorStyle'] })}
                      className="w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--fg)] outline-none focus:border-[var(--accent)]"
                    >
                      <option value="bar">Bar</option>
                      <option value="block">Block</option>
                      <option value="underline">Underline</option>
                    </select>
                  </div>
                  <div className="flex-1">
                    <label className="mb-1.5 block text-sm text-[var(--fg-muted)]">Scrollback</label>
                    <input
                      type="number"
                      min={1000}
                      max={100000}
                      step={1000}
                      value={termSettings.scrollback}
                      onChange={(e) => setTermSettings({ ...termSettings, scrollback: Number(e.target.value) })}
                      className="w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--fg)] outline-none focus:border-[var(--accent)]"
                    />
                  </div>
                </div>

                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={termSettings.cursorBlink}
                    onChange={(e) => setTermSettings({ ...termSettings, cursorBlink: e.target.checked })}
                    className="h-4 w-4 rounded border-[var(--border-strong)] bg-[var(--bg)] text-[var(--accent)] focus:ring-[var(--accent)] focus:ring-offset-0"
                  />
                  <span className="text-sm text-[var(--fg-muted)]">Cursor blink</span>
                </label>
              </div>
            )}

            {activeTab === 'proxy' && (
              <div className="space-y-4">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={proxyConfig.enabled}
                    onChange={(e) => setProxyConfig({ ...proxyConfig, enabled: e.target.checked })}
                    className="h-4 w-4 rounded border-[var(--border-strong)] bg-[var(--bg)] text-[var(--accent)] focus:ring-[var(--accent)] focus:ring-offset-0"
                  />
                  <span className="text-sm text-[var(--fg-muted)]">Enable proxy</span>
                </label>

                {proxyConfig.enabled && (
                  <>
                    <div>
                      <label className="mb-1.5 block text-sm text-[var(--fg-muted)]">Type</label>
                      <select
                        value={proxyConfig.type}
                        onChange={(e) => setProxyConfig({ ...proxyConfig, type: e.target.value as 'http' | 'socks5' })}
                        className="w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--fg)] outline-none focus:border-[var(--accent)]"
                      >
                        <option value="http">HTTP</option>
                        <option value="socks5">SOCKS5</option>
                      </select>
                    </div>

                    <div className="flex gap-3">
                      <div className="flex-1">
                        <label className="mb-1.5 block text-sm text-[var(--fg-muted)]">Host</label>
                        <input
                          type="text"
                          value={proxyConfig.host}
                          onChange={(e) => setProxyConfig({ ...proxyConfig, host: e.target.value })}
                          placeholder="127.0.0.1"
                          className="w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--fg)] placeholder-[var(--fg-subtle)] outline-none focus:border-[var(--accent)]"
                        />
                      </div>
                      <div className="w-24">
                        <label className="mb-1.5 block text-sm text-[var(--fg-muted)]">Port</label>
                        <input
                          type="number"
                          value={proxyConfig.port}
                          onChange={(e) => setProxyConfig({ ...proxyConfig, port: Number(e.target.value) })}
                          className="w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--fg)] outline-none focus:border-[var(--accent)]"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="mb-1.5 block text-sm text-[var(--fg-muted)]">Username (optional)</label>
                      <input
                        type="text"
                        value={proxyConfig.username}
                        onChange={(e) => setProxyConfig({ ...proxyConfig, username: e.target.value })}
                        className="w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--fg)] placeholder-[var(--fg-subtle)] outline-none focus:border-[var(--accent)]"
                      />
                    </div>

                    <div>
                      <label className="mb-1.5 block text-sm text-[var(--fg-muted)]">Password (optional)</label>
                      <input
                        type="password"
                        value={proxyConfig.password}
                        onChange={(e) => setProxyConfig({ ...proxyConfig, password: e.target.value })}
                        className="w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--fg)] placeholder-[var(--fg-subtle)] outline-none focus:border-[var(--accent)]"
                      />
                    </div>
                  </>
                )}

                <div className="flex items-center gap-3">
                  <button
                    onClick={async () => {
                      setProxyTestResult({ status: 'testing' });
                      await window.electronAPI.proxy.set(proxyConfig);
                      const result = await window.electronAPI.proxy.test();
                      if (result.success) {
                        setProxyTestResult({ status: 'ok', message: `Connected (IP: ${result.ip})` });
                      } else {
                        setProxyTestResult({ status: 'fail', message: result.error });
                      }
                      setTimeout(() => setProxyTestResult({ status: 'idle' }), 5000);
                    }}
                    disabled={proxyTestResult.status === 'testing'}
                    className="rounded-lg border border-[var(--border-strong)] bg-[var(--bg)] px-3 py-1.5 text-xs font-medium text-[var(--fg)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-50"
                  >
                    {proxyTestResult.status === 'testing' ? 'Testing...' : 'Test Connection'}
                  </button>
                  {proxyTestResult.status === 'ok' && (
                    <span className="text-xs text-[var(--success)]">{proxyTestResult.message}</span>
                  )}
                  {proxyTestResult.status === 'fail' && (
                    <span className="text-xs text-red-400">{proxyTestResult.message}</span>
                  )}
                </div>
                <p className="text-xs text-[var(--fg-subtle)]">
                  Proxy applies to app traffic (authentication, updates).
                </p>
              </div>
            )}

            {activeTab === 'account' && (
              <div className="space-y-6">
                <div>
                  <h3 className="mb-3 text-sm font-medium text-[var(--fg)]">Signed in as</h3>
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--fg-muted)]">
                    {user?.email ?? 'Unknown'}
                  </div>
                </div>

                <div className="rounded-lg border border-[var(--accent)]/30 bg-[var(--accent)]/8 p-4">
                  <div className="flex items-start gap-3">
                    <svg className="mt-0.5 h-5 w-5 flex-shrink-0 text-[var(--accent)]" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                    </svg>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-medium text-[var(--fg)]">Support development</h3>
                      <p className="mt-1 text-xs text-[var(--fg-muted)]">
                        Magic Term is free and open source. Donations help fund code-signing certificates,
                        infrastructure and new features.
                      </p>
                      <a
                        href={DONATE_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-[var(--accent-fg)] transition-colors hover:opacity-90"
                      >
                        Donate
                        <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3"/>
                        </svg>
                      </a>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="mb-3 text-sm font-medium text-[var(--fg)]">About</h3>
                  <div className="space-y-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-4 text-sm">
                    <div className="flex justify-between">
                      <span className="text-[var(--fg-subtle)]">Version</span>
                      <span className="font-mono text-[var(--fg)]">v{APP_VERSION}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[var(--fg-subtle)]">Website</span>
                      <a href={WEBSITE_URL} target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] hover:underline">
                        magicterm.app
                      </a>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[var(--fg-subtle)]">Source code</span>
                      <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] hover:underline">
                        GitHub
                      </a>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[var(--fg-subtle)]">Report a bug</span>
                      <a href={`${GITHUB_URL}/issues/new`} target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] hover:underline">
                        Open an issue
                      </a>
                    </div>
                  </div>
                </div>

                <div className="border-t border-[var(--border)] pt-6">
                  <h3 className="mb-2 text-sm font-medium text-red-400">Danger zone</h3>
                  <p className="mb-3 text-xs text-[var(--fg-subtle)]">
                    Permanently delete your account. The list below shows exactly what happens to your data.
                    This cannot be undone.
                  </p>

                  {isLoadingPreview && (
                    <div className="mb-3 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-xs text-[var(--fg-subtle)]">
                      Calculating impact...
                    </div>
                  )}

                  {deletePreview && (
                    <div className="mb-3 space-y-2 rounded-lg border border-red-500/30 bg-red-500/5 p-4 text-xs">
                      <div className="text-[var(--fg-muted)]">
                        <span className="font-medium text-[var(--fg)]">Personal data lost:</span>{' '}
                        {deletePreview.personalServers} server{deletePreview.personalServers === 1 ? '' : 's'},{' '}
                        {deletePreview.snippets} snippet{deletePreview.snippets === 1 ? '' : 's'},
                        and your master-key verifier.
                      </div>

                      {deletePreview.orgMemberships > 0 && (
                        <div className="text-[var(--fg-muted)]">
                          <span className="font-medium text-[var(--fg)]">You'll leave</span>{' '}
                          {deletePreview.orgMemberships} organisation{deletePreview.orgMemberships === 1 ? '' : 's'}
                          {' '}you were a member of (their data stays put).
                        </div>
                      )}

                      {deletePreview.orgsToTransfer.length > 0 && (
                        <div>
                          <div className="font-medium text-[var(--fg)]">Ownership will transfer:</div>
                          <ul className="mt-1 space-y-0.5 pl-4">
                            {deletePreview.orgsToTransfer.map((o) => (
                              <li key={o.id} className="text-[var(--fg-muted)] list-disc">
                                <span className="font-medium text-[var(--fg)]">{o.name}</span>
                                {' → '}
                                <span className="font-mono text-[10px] text-[var(--fg-muted)]">
                                  {o.newOwnerEmail}
                                </span>{' '}
                                <span className="text-[var(--fg-subtle)]">(was {o.newOwnerRoleWas})</span>
                              </li>
                            ))}
                          </ul>
                          <p className="mt-1 text-[var(--fg-subtle)]">
                            These organisations and all their servers stay intact.
                          </p>
                        </div>
                      )}

                      {deletePreview.orgsToDelete.length > 0 && (
                        <div>
                          <div className="font-medium text-red-400">
                            Organisations that will be deleted (you're the only member):
                          </div>
                          <ul className="mt-1 space-y-0.5 pl-4">
                            {deletePreview.orgsToDelete.map((o) => (
                              <li key={o.id} className="text-[var(--fg-muted)] list-disc">
                                <span className="font-medium text-[var(--fg)]">{o.name}</span>{' '}
                                <span className="text-red-400">
                                  ({o.serverCount} server{o.serverCount === 1 ? '' : 's'} lost)
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {deletePreview.orgsToTransfer.length === 0 &&
                        deletePreview.orgsToDelete.length === 0 &&
                        deletePreview.orgMemberships === 0 && (
                          <div className="text-[var(--fg-subtle)]">No organisations to worry about.</div>
                        )}
                    </div>
                  )}

                  <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4">
                    <label className="mb-1.5 block text-xs text-[var(--fg-muted)]">
                      Type <span className="font-mono font-semibold text-[var(--fg)]">delete my account</span> to confirm
                    </label>
                    <input
                      type="text"
                      value={deleteConfirm}
                      onChange={(e) => {
                        setDeleteConfirm(e.target.value);
                        setDeleteError(null);
                      }}
                      placeholder="delete my account"
                      className="w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--fg)] placeholder-[var(--fg-subtle)] outline-none focus:border-red-400"
                    />
                    {deleteError && (
                      <div className="mt-2 text-xs text-red-400">{deleteError}</div>
                    )}
                    <button
                      type="button"
                      onClick={async () => {
                        if (deleteConfirm.trim().toLowerCase() !== 'delete my account') {
                          setDeleteError('Confirmation phrase does not match.');
                          return;
                        }
                        setIsDeleting(true);
                        setDeleteError(null);
                        try {
                          await deleteAccount();
                        } catch (err) {
                          setDeleteError((err as Error).message ?? 'Failed to delete account.');
                          setIsDeleting(false);
                        }
                      }}
                      disabled={isDeleting || deleteConfirm.trim().toLowerCase() !== 'delete my account'}
                      className="mt-3 inline-flex items-center justify-center rounded-md border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isDeleting ? 'Deleting...' : 'Delete account permanently'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {error && (
              <div className="rounded-lg bg-red-500/10 p-3 text-sm text-red-400">
                {error}
              </div>
            )}

            {success && (
              <div className="rounded-lg bg-green-500/10 p-3 text-sm text-green-400">
                Settings saved successfully!
              </div>
            )}

            <div className="flex justify-end gap-3 border-t border-[var(--border)] pt-4">
              <Button variant="secondary" onClick={onClose}>
                Close
              </Button>
              {activeTab !== 'account' && (
                <Button onClick={handleSave} disabled={isSaving}>
                  {isSaving ? 'Saving...' : 'Save Changes'}
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
