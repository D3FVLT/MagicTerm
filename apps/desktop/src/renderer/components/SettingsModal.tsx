import { useState, useEffect, type ReactNode } from 'react';
import { Modal } from './ui/Modal';
import { Input } from './ui/Input';
import { Button } from './ui/Button';
import { Select } from './ui/Select';
import { useOrganizations } from '../contexts/OrganizationsContext';
import { useAppTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { MoveVaultPanel } from './MoveVaultPanel';
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
import { DONATE_URL, GITHUB_URL, GITHUB_ISSUES_URL, WEBSITE_URL } from '../lib/links';

declare const __APP_VERSION__: string;

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

const TABS = [
  { id: 'general', label: 'General' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'terminal', label: 'Terminal' },
  { id: 'proxy', label: 'Proxy' },
  { id: 'account', label: 'Account' },
] as const;

type SettingsTab = (typeof TABS)[number]['id'];

const DELETE_PHRASE = 'delete my account';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

function plural(count: number, singular: string, pluralLabel: string): string {
  return `${count} ${count === 1 ? singular : pluralLabel}`;
}

function Row({ children }: { children: ReactNode }) {
  return <div className="border-b border-edge py-3">{children}</div>;
}

function Split({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-edge py-3">
      <div className="min-w-0">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="block text-sm text-fg">
            {label}
          </label>
        ) : (
          <span className="block text-sm text-fg">{label}</span>
        )}
        {hint ? <p className="mt-0.5 text-xs text-fg-subtle">{hint}</p> : null}
      </div>
      {children}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 border-b border-edge py-3">
      <span className="min-w-0">
        <span className="block text-sm text-fg">{label}</span>
        {hint ? <span className="mt-0.5 block text-xs text-fg-subtle">{hint}</span> : null}
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 shrink-0 accent-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      />
    </label>
  );
}

function ExternalRow({ href, label, value }: { href: string; label: string; value?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex items-center justify-between gap-4 border-b border-edge py-3 text-sm outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <span className="text-fg group-hover:underline">{label}</span>
      {value ? <span className="truncate text-fg-muted">{value}</span> : null}
    </a>
  );
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const { organizations } = useOrganizations();
  const { themeId: appThemeId, setTheme: setAppTheme, themes: appThemes } = useAppTheme();
  const { user, deleteAccount, isLocalOnly } = useAuth();
  const [settings, setSettings] = useState<UserSettings>({ nickname: null, defaultOrgId: null });
  const [proxyConfig, setProxyConfig] = useState<ProxyConfig>(DEFAULT_PROXY);
  const [termSettings, setTermSettings] = useState<TerminalSettings>(DEFAULT_TERMINAL_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [proxyTestResult, setProxyTestResult] = useState<{ status: 'idle' | 'testing' | 'ok' | 'fail'; message?: string }>({ status: 'idle' });
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletePreview, setDeletePreview] = useState<AccountDeletionPreview | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);

  useEffect(() => {
    if (!isOpen || activeTab !== 'account' || isLocalOnly) return;
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
  }, [isOpen, activeTab, isLocalOnly]);

  useEffect(() => {
    if (!isOpen) return;

    const loadSettings = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const [userSettings, proxyResult, termResult] = await Promise.all([
          isLocalOnly ? Promise.resolve(null) : getUserSettings(),
          window.electronAPI.proxy.get(),
          window.electronAPI.terminalSettings.get(),
        ]);
        if (userSettings) setSettings(userSettings);
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
  }, [isOpen, isLocalOnly]);

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const saves: Promise<unknown>[] = [
        window.electronAPI.proxy.set(proxyConfig),
        window.electronAPI.terminalSettings.set({
          ...(termSettings as unknown as Record<string, unknown>),
          appThemeId,
        }),
      ];
      if (!isLocalOnly) saves.push(updateUserSettings(settings));
      await Promise.all(saves);
      window.dispatchEvent(new Event('terminal-settings-changed'));
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const testProxy = async () => {
    setProxyTestResult({ status: 'testing' });
    await window.electronAPI.proxy.set(proxyConfig);
    const result = await window.electronAPI.proxy.test();
    if (result.success) {
      setProxyTestResult({ status: 'ok', message: `Connected, ${result.ip ?? 'unknown IP'}` });
    } else {
      setProxyTestResult({ status: 'fail', message: result.error || 'Connection failed.' });
    }
    setTimeout(() => setProxyTestResult({ status: 'idle' }), 5000);
  };

  const confirmDelete = async () => {
    if (deleteConfirm.trim().toLowerCase() !== DELETE_PHRASE) {
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
  };

  const workspaceOptions = [
    { value: '', label: 'Personal (default)' },
    ...organizations.map((org) => ({ value: org.id, label: org.name })),
  ];

  const paletteOptions = Object.entries(TERMINAL_THEMES).map(([id, theme]) => ({
    value: id,
    label: theme.name,
  }));

  const currentTheme = TERMINAL_THEMES[termSettings.themeId] || TERMINAL_THEMES['tokyo-night'];
  const phraseMatches = deleteConfirm.trim().toLowerCase() === DELETE_PHRASE;

  const previewLines = deletePreview
    ? [
        `${plural(deletePreview.personalServers, 'personal server', 'personal servers')}, ${plural(deletePreview.snippets, 'snippet', 'snippets')}, master-key verifier.`,
        ...(deletePreview.orgMemberships > 0
          ? [`Leave ${plural(deletePreview.orgMemberships, 'organization', 'organizations')}. Their data stays.`]
          : []),
        ...deletePreview.orgsToTransfer.map(
          (org) => `${org.name} transfers to ${org.newOwnerEmail} (${org.newOwnerRoleWas}).`,
        ),
        ...deletePreview.orgsToDelete.map(
          (org) => `${org.name} is deleted with ${plural(org.serverCount, 'server', 'servers')}.`,
        ),
      ]
    : [];

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Settings">
      <div>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          </div>
        ) : (
          <>
            <div className="flex border-b border-edge" role="tablist">
              {TABS.map((tab) => {
                const selected = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    onClick={() => setActiveTab(tab.id)}
                    className={`-mb-px border-b-2 px-2 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                      selected
                        ? 'border-accent text-fg'
                        : 'border-transparent text-fg-subtle hover:text-fg'
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            <div className="mt-1" role="tabpanel">
              {activeTab === 'general' && (
                <>
                  {!isLocalOnly && (
                  <>
                  <Row>
                    <label htmlFor="nickname" className="mb-1.5 block text-sm text-fg">
                      Nickname
                    </label>
                    <Input
                      id="nickname"
                      value={settings.nickname || ''}
                      onChange={(e) => setSettings({ ...settings, nickname: e.target.value })}
                    />
                    <p className="mt-1 text-xs text-fg-subtle">Shown instead of your email.</p>
                  </Row>
                  <Row>
                    <label htmlFor="workspace" className="mb-1.5 block text-sm text-fg">
                      Workspace
                    </label>
                    <Select
                      id="workspace"
                      value={settings.defaultOrgId || ''}
                      onChange={(e) => setSettings({ ...settings, defaultOrgId: e.target.value || null })}
                      options={workspaceOptions}
                    />
                    <p className="mt-1 text-xs text-fg-subtle">Selected when the app opens.</p>
                  </Row>
                  </>
                  )}
                  <Toggle
                    label="Support card"
                    hint="On the Vaults page."
                    checked={termSettings.showSupportCard}
                    onChange={(checked) => setTermSettings({ ...termSettings, showSupportCard: checked })}
                  />
                </>
              )}

              {activeTab === 'appearance' && (
                <>
                  <p className="py-3 text-xs text-fg-subtle">
                    Switches the paired palette, unless you set another.
                  </p>
                  {appThemes.map((theme) => {
                    const isActive = appThemeId === theme.id;
                    return (
                      <button
                        key={theme.id}
                        type="button"
                        aria-pressed={isActive}
                        onClick={() => {
                          setAppTheme(theme.id);
                          const previousAppTheme = APP_THEMES[appThemeId];
                          const shouldFollowTerminal =
                            previousAppTheme &&
                            termSettings.themeId === previousAppTheme.defaultTerminalThemeId;
                          setTermSettings((prev) => ({
                            ...prev,
                            appThemeId: theme.id,
                            themeId: shouldFollowTerminal ? theme.defaultTerminalThemeId : prev.themeId,
                          }));
                          if (shouldFollowTerminal) {
                            window.dispatchEvent(new Event('terminal-settings-changed'));
                          }
                        }}
                        className={`flex w-full items-baseline justify-between gap-4 border-b-2 py-2.5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                          isActive ? 'border-accent' : 'border-edge'
                        }`}
                      >
                        <span className="text-sm text-fg">{theme.name}</span>
                        <span className="text-xs text-fg-subtle">{theme.description}</span>
                      </button>
                    );
                  })}
                </>
              )}

              {activeTab === 'terminal' && (
                <>
                  <Row>
                    <label htmlFor="palette" className="mb-1.5 block text-sm text-fg">
                      Palette
                    </label>
                    <Select
                      id="palette"
                      value={termSettings.themeId}
                      onChange={(e) => setTermSettings({ ...termSettings, themeId: e.target.value })}
                      options={paletteOptions}
                    />
                    <div
                      className="mt-2 truncate px-2 py-1 font-mono"
                      style={{
                        backgroundColor: currentTheme.background,
                        color: currentTheme.foreground,
                        fontFamily: termSettings.fontFamily,
                        fontSize: `${termSettings.fontSize}px`,
                        lineHeight: termSettings.lineHeight,
                      }}
                    >
                      <span style={{ color: currentTheme.green }}>user</span>
                      <span>@</span>
                      <span style={{ color: currentTheme.blue }}>server</span>
                      <span>:</span>
                      <span style={{ color: currentTheme.cyan }}>~</span>
                      <span>$ </span>
                      <span style={{ color: currentTheme.yellow }}>ls</span>
                    </div>
                  </Row>
                  <Row>
                    <label htmlFor="terminal-font" className="mb-1.5 block text-sm text-fg">
                      Font
                    </label>
                    <Select
                      id="terminal-font"
                      value={termSettings.fontFamily}
                      onChange={(e) => setTermSettings({ ...termSettings, fontFamily: e.target.value })}
                      options={FONT_OPTIONS}
                    />
                  </Row>
                  <Split label="Size" htmlFor="font-size">
                    <div className="flex w-40 items-center gap-2">
                      <input
                        id="font-size"
                        type="range"
                        min={10}
                        max={24}
                        value={termSettings.fontSize}
                        onChange={(e) => setTermSettings({ ...termSettings, fontSize: Number(e.target.value) })}
                        className="w-full accent-accent"
                      />
                      <span className="w-8 text-right font-mono text-xs text-fg">{termSettings.fontSize}</span>
                    </div>
                  </Split>
                  <Split label="Line height" htmlFor="line-height">
                    <div className="flex w-40 items-center gap-2">
                      <input
                        id="line-height"
                        type="range"
                        min={10}
                        max={18}
                        value={Math.round(termSettings.lineHeight * 10)}
                        onChange={(e) => setTermSettings({ ...termSettings, lineHeight: Number(e.target.value) / 10 })}
                        className="w-full accent-accent"
                      />
                      <span className="w-8 text-right font-mono text-xs text-fg">{termSettings.lineHeight.toFixed(1)}</span>
                    </div>
                  </Split>
                  <Row>
                    <label htmlFor="cursor-style" className="mb-1.5 block text-sm text-fg">
                      Cursor
                    </label>
                    <Select
                      id="cursor-style"
                      value={termSettings.cursorStyle}
                      onChange={(e) =>
                        setTermSettings({
                          ...termSettings,
                          cursorStyle: e.target.value as TerminalSettings['cursorStyle'],
                        })
                      }
                      options={[
                        { value: 'bar', label: 'Bar' },
                        { value: 'block', label: 'Block' },
                        { value: 'underline', label: 'Underline' },
                      ]}
                    />
                  </Row>
                  <Split label="Scrollback" htmlFor="scrollback">
                    <div className="w-24">
                      <Input
                        id="scrollback"
                        type="number"
                        min={1000}
                        max={100000}
                        step={1000}
                        value={termSettings.scrollback}
                        onChange={(e) => setTermSettings({ ...termSettings, scrollback: Number(e.target.value) })}
                      />
                    </div>
                  </Split>
                  <Toggle
                    label="Cursor blink"
                    checked={termSettings.cursorBlink}
                    onChange={(checked) => setTermSettings({ ...termSettings, cursorBlink: checked })}
                  />
                </>
              )}

              {activeTab === 'proxy' && (
                <>
                  <Toggle
                    label="Proxy"
                    hint="Sign-in and updates."
                    checked={proxyConfig.enabled}
                    onChange={(checked) => setProxyConfig({ ...proxyConfig, enabled: checked })}
                  />
                  {proxyConfig.enabled && (
                    <>
                      <Row>
                        <label htmlFor="proxy-type" className="mb-1.5 block text-sm text-fg">
                          Type
                        </label>
                        <Select
                          id="proxy-type"
                          value={proxyConfig.type}
                          onChange={(e) =>
                            setProxyConfig({ ...proxyConfig, type: e.target.value as ProxyConfig['type'] })
                          }
                          options={[
                            { value: 'http', label: 'HTTP' },
                            { value: 'socks5', label: 'SOCKS5' },
                          ]}
                        />
                      </Row>
                      <Row>
                        <label htmlFor="proxy-host" className="mb-1.5 block text-sm text-fg">
                          Host
                        </label>
                        <Input
                          id="proxy-host"
                          type="text"
                          value={proxyConfig.host}
                          onChange={(e) => setProxyConfig({ ...proxyConfig, host: e.target.value })}
                          placeholder="127.0.0.1"
                        />
                      </Row>
                      <Split label="Port" htmlFor="proxy-port">
                        <div className="w-24">
                          <Input
                            id="proxy-port"
                            type="number"
                            value={proxyConfig.port}
                            onChange={(e) => setProxyConfig({ ...proxyConfig, port: Number(e.target.value) })}
                          />
                        </div>
                      </Split>
                      <Row>
                        <label htmlFor="proxy-username" className="mb-1.5 block text-sm text-fg">
                          Username
                        </label>
                        <Input
                          id="proxy-username"
                          type="text"
                          value={proxyConfig.username}
                          onChange={(e) => setProxyConfig({ ...proxyConfig, username: e.target.value })}
                          placeholder="Optional"
                        />
                      </Row>
                      <Row>
                        <label htmlFor="proxy-password" className="mb-1.5 block text-sm text-fg">
                          Password
                        </label>
                        <Input
                          id="proxy-password"
                          type="password"
                          value={proxyConfig.password}
                          onChange={(e) => setProxyConfig({ ...proxyConfig, password: e.target.value })}
                          placeholder="Optional"
                        />
                      </Row>
                    </>
                  )}
                  <div className="flex items-center gap-3 border-b border-edge py-3">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => { void testProxy(); }}
                      disabled={proxyTestResult.status === 'testing'}
                    >
                      {proxyTestResult.status === 'testing' ? 'Testing...' : 'Test'}
                    </Button>
                    {proxyTestResult.status === 'ok' && (
                      <span className="text-xs text-success">{proxyTestResult.message}</span>
                    )}
                    {proxyTestResult.status === 'fail' && (
                      <span className="text-xs text-danger">{proxyTestResult.message}</span>
                    )}
                  </div>
                </>
              )}

              {activeTab === 'account' && (
                <>
                  {!isLocalOnly && (
                  <div className="flex items-center justify-between gap-4 border-b border-edge py-3">
                    <span className="text-sm text-fg">Email</span>
                    <span className="min-w-0 truncate text-sm text-fg-muted">{user?.email ?? 'Unknown'}</span>
                  </div>
                  )}
                  <ExternalRow href={DONATE_URL} label="Donate" />
                  <div className="flex items-center justify-between border-b border-edge py-3 text-sm">
                    <span className="text-fg">Version</span>
                    <span className="font-mono text-fg-muted">v{__APP_VERSION__}</span>
                  </div>
                  <ExternalRow href={WEBSITE_URL} label="Website" value="magicterm.app" />
                  <ExternalRow href={GITHUB_URL} label="Source" value="GitHub" />
                  <ExternalRow href={GITHUB_ISSUES_URL} label="Report a bug" value="Issues" />
                  {isLocalOnly ? (
                    <MoveVaultPanel />
                  ) : (
                  <div className="pt-4">
                    <p className="text-sm text-fg">Delete account</p>
                    <p className="mt-1 text-xs text-fg-subtle">
                      Permanent. Type <span className="font-mono text-fg">{DELETE_PHRASE}</span> to confirm.
                    </p>
                    {isLoadingPreview && previewLines.length === 0 && (
                      <p className="mt-2 text-xs text-fg-subtle">Checking data.</p>
                    )}
                    {previewLines.length > 0 && (
                      <ul className="mt-2 space-y-1 text-xs text-fg-muted">
                        {previewLines.map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    )}
                    <div className="mt-3">
                      <Input
                        id="delete-confirm"
                        type="text"
                        value={deleteConfirm}
                        onChange={(e) => {
                          setDeleteConfirm(e.target.value);
                          setDeleteError(null);
                        }}
                        placeholder={DELETE_PHRASE}
                        error={deleteError ?? undefined}
                        aria-label="Confirmation phrase"
                      />
                    </div>
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      className="mt-3"
                      onClick={() => { void confirmDelete(); }}
                      disabled={isDeleting || !phraseMatches}
                    >
                      {isDeleting ? 'Deleting...' : 'Delete account'}
                    </Button>
                  </div>
                  )}
                </>
              )}
            </div>

            {error && (
              <p className="pt-3 text-sm text-danger" role="alert">
                {error}
              </p>
            )}

            <div className="flex justify-end gap-2 pt-4">
              <Button type="button" variant="secondary" size="sm" onClick={onClose}>
                Close
              </Button>
              {activeTab !== 'account' && (
                <Button type="button" size="sm" onClick={() => { void handleSave(); }} disabled={isSaving}>
                  {isSaving ? 'Saving...' : success ? 'Saved' : 'Save'}
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
