import { useEffect, useState } from 'react';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Select } from './ui/Select';
import {
  AI_PROVIDERS,
  PROVIDER_LABEL,
  PROVIDER_MODELS,
  activeProfile,
  parseAiSettings,
  profileLabel,
  providerDefaults,
  providerNeedsKey,
  resolveChatUrl,
  type AiProfile,
  type AiProvider,
  type AiSettings,
} from '../../common/ai-assistant';
import { decryptApiKey, encryptApiKey, loadAiSettings, saveAiSettings } from '../lib/ai-settings';
import { verifyModel } from '../lib/ai-client';

interface EditDraft {
  id: string;
  provider: AiProvider;
  model: string;
  custom: string;
  baseUrl: string;
  key: string;
  revealed: boolean;
}

export function AssistantSettings() {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [addProvider, setAddProvider] = useState<AiProvider>('ollama');
  const [addModel, setAddModel] = useState(PROVIDER_MODELS.ollama[0].id);
  const [addCustom, setAddCustom] = useState('');
  const [addBaseUrl, setAddBaseUrl] = useState(providerDefaults('ollama').baseUrl);
  const [addKey, setAddKey] = useState('');
  const [edit, setEdit] = useState<EditDraft | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [revealing, setRevealing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadAiSettings()
      .then((loaded) => {
        if (!cancelled) setSettings(loaded);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load assistant settings');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = async (next: AiSettings, savedNotice: string) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const parsed = parseAiSettings(next);
      if (!parsed.ok) throw new Error(parsed.error);
      await saveAiSettings(parsed.settings);
      setSettings(parsed.settings);
      setNotice(savedNotice);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  const onProvider = (next: AiProvider) => {
    const defaults = providerDefaults(next);
    setAddProvider(next);
    setAddModel(defaults.model);
    setAddBaseUrl(defaults.baseUrl);
    setAddCustom('');
    setAddKey('');
  };

  const addProfile = async () => {
    if (!settings || busy || adding) return;
    const model = addCustom.trim() || addModel;
    const baseUrl = addBaseUrl.trim();
    const endpoint = resolveChatUrl(addProvider, baseUrl);
    if ('error' in endpoint) {
      setError(endpoint.error);
      setNotice('');
      return;
    }
    const duplicate = settings.profiles.some(
      (profile) => profile.provider === addProvider && profile.model === model && profile.baseUrl === baseUrl
    );
    if (duplicate) {
      setError('That model is already in the list');
      setNotice('');
      return;
    }
    setAdding(true);
    setError('');
    setNotice('');
    try {
      const draft = addKey.trim();
      let apiKey = '';
      let apiKeyCiphertext = '';
      if (providerNeedsKey(addProvider)) {
        if (!draft) throw new Error('Paste a key for this model');
        apiKey = draft;
        apiKeyCiphertext = await encryptApiKey(draft);
      }
      await verifyModel({ provider: addProvider, model, baseUrl, apiKey });
      const profile = {
        id: crypto.randomUUID(),
        provider: addProvider,
        model,
        baseUrl,
        apiKeyCiphertext,
        verified: true as const,
      };
      const parsed = parseAiSettings({
        ...settings,
        profiles: [...settings.profiles, profile],
        activeProfileId: settings.profiles.length === 0 ? profile.id : settings.activeProfileId,
      });
      if (!parsed.ok) throw new Error(parsed.error);
      await saveAiSettings(parsed.settings);
      setSettings(parsed.settings);
      setAddCustom('');
      setAddKey('');
      setNotice('Model checked and added');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Check failed');
    } finally {
      setAdding(false);
    }
  };

  const removeProfile = (id: string) => {
    if (!settings || busy) return;
    if (edit?.id === id) setEdit(null);
    const profiles = settings.profiles.filter((profile) => profile.id !== id);
    const activeProfileId = profiles.some((profile) => profile.id === settings.activeProfileId)
      ? settings.activeProfileId
      : profiles[0]?.id ?? '';
    void persist({ ...settings, profiles, activeProfileId }, profiles.length === 0 ? 'No models configured' : 'Model removed');
  };

  const openEdit = (profile: AiProfile) => {
    const known = PROVIDER_MODELS[profile.provider].some((item) => item.id === profile.model);
    setEdit({
      id: profile.id,
      provider: profile.provider,
      model: known ? profile.model : PROVIDER_MODELS[profile.provider][0].id,
      custom: known ? '' : profile.model,
      baseUrl: profile.baseUrl,
      key: '',
      revealed: false,
    });
    setError('');
    setNotice('');
  };

  const onEditProvider = (next: AiProvider) => {
    const defaults = providerDefaults(next);
    setEdit((current) => current ? {
      ...current,
      provider: next,
      model: defaults.model,
      custom: '',
      baseUrl: defaults.baseUrl,
      key: '',
      revealed: false,
    } : current);
  };

  const revealKey = async (profile: AiProfile) => {
    if (!edit || edit.id !== profile.id || revealing) return;
    if (edit.revealed) {
      setEdit({ ...edit, revealed: false });
      return;
    }
    if (edit.key.trim() || !profile.apiKeyCiphertext) {
      setEdit({ ...edit, revealed: true });
      return;
    }
    setRevealing(true);
    setError('');
    try {
      const plain = await decryptApiKey(profile.apiKeyCiphertext);
      setEdit((current) => {
        if (!current || current.id !== profile.id) return current;
        if (current.key.trim()) return { ...current, revealed: true };
        return { ...current, key: plain, revealed: true };
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not show the key');
    } finally {
      setRevealing(false);
    }
  };

  const saveEdit = async () => {
    if (!settings || !edit || busy || adding || saving) return;
    const original = settings.profiles.find((profile) => profile.id === edit.id);
    if (!original) return;
    const model = edit.custom.trim() || edit.model;
    const baseUrl = edit.baseUrl.trim();
    const endpoint = resolveChatUrl(edit.provider, baseUrl);
    if ('error' in endpoint) {
      setError(endpoint.error);
      setNotice('');
      return;
    }
    const duplicate = settings.profiles.some(
      (profile) => profile.id !== edit.id
        && profile.provider === edit.provider
        && profile.model === model
        && profile.baseUrl === baseUrl
    );
    if (duplicate) {
      setError('That model is already in the list');
      setNotice('');
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const needsKey = providerNeedsKey(edit.provider);
      const draft = edit.key.trim();
      const modelChanged = original.provider !== edit.provider || original.model !== model || original.baseUrl !== baseUrl;
      let apiKeyCiphertext = needsKey ? original.apiKeyCiphertext : '';
      let apiKey = '';
      let keyChanged = false;
      if (needsKey) {
        if (draft) {
          const saved = original.apiKeyCiphertext ? await decryptApiKey(original.apiKeyCiphertext) : '';
          apiKey = draft;
          keyChanged = draft !== saved;
          if (keyChanged) apiKeyCiphertext = await encryptApiKey(draft);
        } else if (!original.apiKeyCiphertext) {
          throw new Error('Paste a key for this model');
        } else if (modelChanged) {
          apiKey = await decryptApiKey(original.apiKeyCiphertext);
        }
      }
      if (keyChanged || modelChanged) {
        await verifyModel({ provider: edit.provider, model, baseUrl, apiKey });
      }
      const profiles = settings.profiles.map((profile) => profile.id === edit.id
        ? { ...profile, provider: edit.provider, model, baseUrl, apiKeyCiphertext, verified: true as const }
        : profile);
      const parsed = parseAiSettings({ ...settings, profiles });
      if (!parsed.ok) throw new Error(parsed.error);
      if (keyChanged || modelChanged) {
        await saveAiSettings(parsed.settings);
        setSettings(parsed.settings);
        setNotice('Model updated');
      }
      setEdit(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Check failed');
    } finally {
      setSaving(false);
    }
  };

  const current = settings ? activeProfile(settings) : null;

  return (
    <div>
      <p className="border-b border-edge py-3 text-sm text-fg-muted">
        Bring your own key. It is encrypted with the master password and stays on this computer.
        The chat only lists a model after it passes a check. A suggested command is pasted into the terminal and does not run until you press Enter.
      </p>

      <div className="border-b border-edge py-3">
        <p className="text-sm text-fg">Configured models</p>
        <p className="mt-0.5 text-xs text-fg-subtle">
          {!settings ? 'Loading…' : current ? `Active in the chat: ${profileLabel(current)}` : 'Nothing checked yet.'}
        </p>
        <ul className="mt-2">
          {settings?.profiles.map((profile) => {
            const active = profile.id === settings.activeProfileId;
            const editing = edit?.id === profile.id ? edit : null;
            return (
              <li key={profile.id} className="py-1.5">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className={`min-w-0 flex-1 truncate text-left text-sm ${active ? 'text-fg' : 'text-fg-muted hover:text-fg'}`}
                    onClick={() => {
                      if (!active) void persist({ ...settings, activeProfileId: profile.id }, 'Active model updated');
                    }}
                  >
                  {profileLabel(profile)}
                  {active ? ' · active' : ''}
                  {providerNeedsKey(profile.provider) && !profile.apiKeyCiphertext ? ' · no key' : ''}
                  </button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={busy || saving}
                    onClick={() => (editing ? setEdit(null) : openEdit(profile))}
                  >
                    {editing ? 'Close' : 'Edit'}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={busy || saving}
                    onClick={() => removeProfile(profile.id)}
                  >
                    Remove
                  </Button>
                </div>
                {editing && (
                  <div className="mt-2 space-y-3">
                    <Select
                      id={`assistant-edit-provider-${profile.id}`}
                      label="Provider"
                      value={editing.provider}
                      onChange={(event) => onEditProvider(event.target.value as AiProvider)}
                      options={AI_PROVIDERS.map((id) => ({ value: id, label: PROVIDER_LABEL[id] }))}
                    />
                    <Select
                      id={`assistant-edit-model-${profile.id}`}
                      label="Model"
                      value={editing.model}
                      onChange={(event) => {
                        const model = event.target.value;
                        setEdit((current) => current?.id === profile.id ? { ...current, model } : current);
                      }}
                      options={PROVIDER_MODELS[editing.provider].map((item) => ({ value: item.id, label: item.label }))}
                    />
                    <Input
                      id={`assistant-edit-custom-${profile.id}`}
                      label="Custom model"
                      value={editing.custom}
                      onChange={(event) => {
                        const custom = event.target.value;
                        setEdit((current) => current?.id === profile.id ? { ...current, custom } : current);
                      }}
                      placeholder="Optional. Used instead of the list"
                      spellCheck={false}
                    />
                    <Input
                      id={`assistant-edit-url-${profile.id}`}
                      label="Base URL"
                      value={editing.baseUrl}
                      onChange={(event) => {
                        const baseUrl = event.target.value;
                        setEdit((current) => current?.id === profile.id ? { ...current, baseUrl } : current);
                      }}
                      spellCheck={false}
                    />
                    {providerNeedsKey(editing.provider) && (
                      <div className="space-y-2">
                        {!profile.apiKeyCiphertext && (
                          <p className="text-xs text-fg-subtle">No key saved. Paste one.</p>
                        )}
                        <div className="flex items-end gap-2">
                          <div className="min-w-0 flex-1">
                            <Input
                              id={`assistant-edit-key-${profile.id}`}
                              label="API key"
                              type={editing.revealed ? 'text' : 'password'}
                              value={editing.key}
                              onChange={(event) => {
                                const key = event.target.value;
                                setEdit((current) => current?.id === profile.id ? { ...current, key } : current);
                              }}
                              placeholder={profile.apiKeyCiphertext ? 'Key saved' : 'Paste the key'}
                              autoComplete="off"
                              spellCheck={false}
                              className={editing.revealed ? 'font-mono text-xs' : ''}
                            />
                          </div>
                          {(profile.apiKeyCiphertext || editing.key) && (
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              disabled={revealing}
                              onClick={() => { void revealKey(profile); }}
                            >
                              {editing.revealed ? 'Hide' : 'Show'}
                            </Button>
                          )}
                        </div>
                      </div>
                    )}
                    {error && <p className="text-sm text-danger" role="alert">{error}</p>}
                    {notice && <p className="text-sm text-fg-muted">{notice}</p>}
                    <Button type="button" size="sm" disabled={busy || saving} onClick={() => { void saveEdit(); }}>
                      {saving ? 'Checking…' : 'Save'}
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      <div className="space-y-3 py-3">
        <p className="text-sm text-fg">Add a model</p>
        <Select
          id="assistant-add-provider"
          label="Provider"
          value={addProvider}
          onChange={(event) => onProvider(event.target.value as AiProvider)}
          options={AI_PROVIDERS.map((id) => ({ value: id, label: PROVIDER_LABEL[id] }))}
        />
        <Select
          id="assistant-add-model"
          label="Model"
          value={addModel}
          onChange={(event) => setAddModel(event.target.value)}
          options={PROVIDER_MODELS[addProvider].map((item) => ({ value: item.id, label: item.label }))}
        />
        <Input
          id="assistant-add-custom"
          label="Custom model"
          value={addCustom}
          onChange={(event) => setAddCustom(event.target.value)}
          placeholder="Optional. Used instead of the list"
          spellCheck={false}
        />
        <Input
          id="assistant-add-url"
          label="Base URL"
          value={addBaseUrl}
          onChange={(event) => setAddBaseUrl(event.target.value)}
          spellCheck={false}
        />
        {providerNeedsKey(addProvider) && (
          <Input
            id="assistant-add-key"
            label="API key"
            type="password"
            value={addKey}
            onChange={(event) => setAddKey(event.target.value)}
            placeholder="Paste the key"
            autoComplete="off"
            spellCheck={false}
          />
        )}
        {edit == null && error && <p className="text-sm text-danger" role="alert">{error}</p>}
        {edit == null && notice && <p className="text-sm text-fg-muted">{notice}</p>}
        <Button type="button" size="sm" disabled={busy || adding || !settings} onClick={() => { void addProfile(); }}>
          {adding ? 'Checking…' : 'Check and add'}
        </Button>
      </div>
    </div>
  );
}
