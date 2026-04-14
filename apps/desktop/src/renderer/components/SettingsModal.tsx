import { useState, useEffect } from 'react';
import { Modal } from './ui/Modal';
import { Input } from './ui/Input';
import { Button } from './ui/Button';
import { Select } from './ui/Select';
import { useOrganizations } from '../contexts/OrganizationsContext';
import { getUserSettings, updateUserSettings } from '@magicterm/supabase-client';
import type { UserSettings } from '@magicterm/shared';
import {
  TERMINAL_THEMES,
  FONT_OPTIONS,
  DEFAULT_TERMINAL_SETTINGS,
  type TerminalSettings,
} from '../lib/terminal-themes';

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
  const [settings, setSettings] = useState<UserSettings>({ nickname: null, defaultOrgId: null });
  const [proxyConfig, setProxyConfig] = useState<ProxyConfig>(DEFAULT_PROXY);
  const [termSettings, setTermSettings] = useState<TerminalSettings>(DEFAULT_TERMINAL_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [proxyTestResult, setProxyTestResult] = useState<{ status: 'idle' | 'testing' | 'ok' | 'fail'; message?: string }>({ status: 'idle' });
  const [activeTab, setActiveTab] = useState<'general' | 'terminal' | 'proxy'>('general');

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
        window.electronAPI.terminalSettings.set(termSettings as unknown as Record<string, unknown>),
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
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#7aa2f7] border-t-transparent" />
          </div>
        ) : (
          <>
            <div className="flex gap-1 border-b border-[#292e42]">
              {(['general', 'terminal', 'proxy'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-3 py-2 text-xs font-medium capitalize transition-colors ${
                    activeTab === tab
                      ? 'border-b-2 border-[#7aa2f7] text-[#7aa2f7]'
                      : 'text-[#565f89] hover:text-[#a9b1d6]'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>

            {activeTab === 'general' && (
              <div className="space-y-6">
                <div>
                  <h3 className="mb-4 text-sm font-medium text-[#c0caf5]">Profile</h3>
                  <div className="space-y-4">
                    <div>
                      <label className="mb-1.5 block text-sm text-[#a9b1d6]">Nickname</label>
                      <Input
                        value={settings.nickname || ''}
                        onChange={(e) => setSettings({ ...settings, nickname: e.target.value })}
                        placeholder="Enter your nickname (shown instead of email)"
                      />
                      <p className="mt-1 text-xs text-[#565f89]">
                        Your nickname will be displayed to other team members instead of your email address.
                      </p>
                    </div>
                  </div>
                </div>
                <div className="border-t border-[#292e42] pt-6">
                  <h3 className="mb-4 text-sm font-medium text-[#c0caf5]">Workspace</h3>
                  <div className="space-y-4">
                    <div>
                      <label className="mb-1.5 block text-sm text-[#a9b1d6]">Default Workspace</label>
                      <Select
                        value={settings.defaultOrgId || ''}
                        onChange={(e) => setSettings({ ...settings, defaultOrgId: e.target.value || null })}
                        options={workspaceOptions}
                      />
                      <p className="mt-1 text-xs text-[#565f89]">
                        This workspace will be selected automatically when you open the app.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'terminal' && (
              <div className="space-y-5">
                <div>
                  <label className="mb-1.5 block text-sm text-[#a9b1d6]">Theme</label>
                  <div className="grid grid-cols-2 gap-2">
                    {Object.entries(TERMINAL_THEMES).map(([id, theme]) => (
                      <button
                        key={id}
                        onClick={() => setTermSettings({ ...termSettings, themeId: id })}
                        className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                          termSettings.themeId === id
                            ? 'border-[#7aa2f7] bg-[#7aa2f7]/10'
                            : 'border-[#292e42] hover:border-[#414868]'
                        }`}
                      >
                        <div className="flex gap-0.5">
                          {[theme.red, theme.green, theme.yellow, theme.blue, theme.magenta, theme.cyan].map((c, i) => (
                            <div key={i} className="h-3 w-3 rounded-sm" style={{ backgroundColor: c }} />
                          ))}
                        </div>
                        <span className="text-[#c0caf5] truncate">{theme.name}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div
                  className="overflow-hidden rounded-lg border border-[#292e42] p-3 font-mono text-xs leading-relaxed"
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
                  <label className="mb-1.5 block text-sm text-[#a9b1d6]">Font Family</label>
                  <select
                    value={termSettings.fontFamily}
                    onChange={(e) => setTermSettings({ ...termSettings, fontFamily: e.target.value })}
                    className="w-full rounded-lg border border-[#414868] bg-[#1a1b26] px-3 py-2 text-sm text-[#c0caf5] outline-none focus:border-[#7aa2f7]"
                  >
                    {FONT_OPTIONS.map((f) => (
                      <option key={f.label} value={f.value}>{f.label}</option>
                    ))}
                  </select>
                </div>

                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="mb-1.5 block text-sm text-[#a9b1d6]">Font Size</label>
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min={10}
                        max={24}
                        value={termSettings.fontSize}
                        onChange={(e) => setTermSettings({ ...termSettings, fontSize: Number(e.target.value) })}
                        className="flex-1 accent-[#7aa2f7]"
                      />
                      <span className="w-8 text-center text-sm text-[#c0caf5]">{termSettings.fontSize}</span>
                    </div>
                  </div>
                  <div className="flex-1">
                    <label className="mb-1.5 block text-sm text-[#a9b1d6]">Line Height</label>
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min={10}
                        max={18}
                        value={Math.round(termSettings.lineHeight * 10)}
                        onChange={(e) => setTermSettings({ ...termSettings, lineHeight: Number(e.target.value) / 10 })}
                        className="flex-1 accent-[#7aa2f7]"
                      />
                      <span className="w-8 text-center text-sm text-[#c0caf5]">{termSettings.lineHeight.toFixed(1)}</span>
                    </div>
                  </div>
                </div>

                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="mb-1.5 block text-sm text-[#a9b1d6]">Cursor Style</label>
                    <select
                      value={termSettings.cursorStyle}
                      onChange={(e) => setTermSettings({ ...termSettings, cursorStyle: e.target.value as TerminalSettings['cursorStyle'] })}
                      className="w-full rounded-lg border border-[#414868] bg-[#1a1b26] px-3 py-2 text-sm text-[#c0caf5] outline-none focus:border-[#7aa2f7]"
                    >
                      <option value="bar">Bar</option>
                      <option value="block">Block</option>
                      <option value="underline">Underline</option>
                    </select>
                  </div>
                  <div className="flex-1">
                    <label className="mb-1.5 block text-sm text-[#a9b1d6]">Scrollback</label>
                    <input
                      type="number"
                      min={1000}
                      max={100000}
                      step={1000}
                      value={termSettings.scrollback}
                      onChange={(e) => setTermSettings({ ...termSettings, scrollback: Number(e.target.value) })}
                      className="w-full rounded-lg border border-[#414868] bg-[#1a1b26] px-3 py-2 text-sm text-[#c0caf5] outline-none focus:border-[#7aa2f7]"
                    />
                  </div>
                </div>

                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={termSettings.cursorBlink}
                    onChange={(e) => setTermSettings({ ...termSettings, cursorBlink: e.target.checked })}
                    className="h-4 w-4 rounded border-[#414868] bg-[#1a1b26] text-[#7aa2f7] focus:ring-[#7aa2f7] focus:ring-offset-0"
                  />
                  <span className="text-sm text-[#a9b1d6]">Cursor blink</span>
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
                    className="h-4 w-4 rounded border-[#414868] bg-[#1a1b26] text-[#7aa2f7] focus:ring-[#7aa2f7] focus:ring-offset-0"
                  />
                  <span className="text-sm text-[#a9b1d6]">Enable proxy</span>
                </label>

                {proxyConfig.enabled && (
                  <>
                    <div>
                      <label className="mb-1.5 block text-sm text-[#a9b1d6]">Type</label>
                      <select
                        value={proxyConfig.type}
                        onChange={(e) => setProxyConfig({ ...proxyConfig, type: e.target.value as 'http' | 'socks5' })}
                        className="w-full rounded-lg border border-[#414868] bg-[#1a1b26] px-3 py-2 text-sm text-[#c0caf5] outline-none focus:border-[#7aa2f7]"
                      >
                        <option value="http">HTTP</option>
                        <option value="socks5">SOCKS5</option>
                      </select>
                    </div>

                    <div className="flex gap-3">
                      <div className="flex-1">
                        <label className="mb-1.5 block text-sm text-[#a9b1d6]">Host</label>
                        <input
                          type="text"
                          value={proxyConfig.host}
                          onChange={(e) => setProxyConfig({ ...proxyConfig, host: e.target.value })}
                          placeholder="127.0.0.1"
                          className="w-full rounded-lg border border-[#414868] bg-[#1a1b26] px-3 py-2 text-sm text-[#c0caf5] placeholder-[#565f89] outline-none focus:border-[#7aa2f7]"
                        />
                      </div>
                      <div className="w-24">
                        <label className="mb-1.5 block text-sm text-[#a9b1d6]">Port</label>
                        <input
                          type="number"
                          value={proxyConfig.port}
                          onChange={(e) => setProxyConfig({ ...proxyConfig, port: Number(e.target.value) })}
                          className="w-full rounded-lg border border-[#414868] bg-[#1a1b26] px-3 py-2 text-sm text-[#c0caf5] outline-none focus:border-[#7aa2f7]"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="mb-1.5 block text-sm text-[#a9b1d6]">Username (optional)</label>
                      <input
                        type="text"
                        value={proxyConfig.username}
                        onChange={(e) => setProxyConfig({ ...proxyConfig, username: e.target.value })}
                        className="w-full rounded-lg border border-[#414868] bg-[#1a1b26] px-3 py-2 text-sm text-[#c0caf5] placeholder-[#565f89] outline-none focus:border-[#7aa2f7]"
                      />
                    </div>

                    <div>
                      <label className="mb-1.5 block text-sm text-[#a9b1d6]">Password (optional)</label>
                      <input
                        type="password"
                        value={proxyConfig.password}
                        onChange={(e) => setProxyConfig({ ...proxyConfig, password: e.target.value })}
                        className="w-full rounded-lg border border-[#414868] bg-[#1a1b26] px-3 py-2 text-sm text-[#c0caf5] placeholder-[#565f89] outline-none focus:border-[#7aa2f7]"
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
                    className="rounded-lg border border-[#414868] bg-[#1a1b26] px-3 py-1.5 text-xs font-medium text-[#c0caf5] transition-colors hover:border-[#7aa2f7] hover:text-[#7aa2f7] disabled:opacity-50"
                  >
                    {proxyTestResult.status === 'testing' ? 'Testing...' : 'Test Connection'}
                  </button>
                  {proxyTestResult.status === 'ok' && (
                    <span className="text-xs text-[#9ece6a]">{proxyTestResult.message}</span>
                  )}
                  {proxyTestResult.status === 'fail' && (
                    <span className="text-xs text-red-400">{proxyTestResult.message}</span>
                  )}
                </div>
                <p className="text-xs text-[#565f89]">
                  Proxy applies to app traffic (authentication, updates).
                </p>
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

            <div className="flex justify-end gap-3 border-t border-[#292e42] pt-4">
              <Button variant="secondary" onClick={onClose}>
                Close
              </Button>
              <Button onClick={handleSave} disabled={isSaving}>
                {isSaving ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
