import { cryptoManager } from '@magicterm/crypto';
import { defaultAiSettings, parseAiSettings, type AiSettings } from '../../common/ai-assistant';

export const AI_SETTINGS_EVENT = 'magicterm:ai-settings';
export const OPEN_SETTINGS_EVENT = 'magicterm:open-settings';

export function openSettings(tab: 'general' | 'assistant'): void {
  window.dispatchEvent(new CustomEvent(OPEN_SETTINGS_EVENT, { detail: { tab } }));
}

export async function loadAiSettings(): Promise<AiSettings> {
  const result = await window.electronAPI.aiSettings.get();
  const parsed = parseAiSettings(result.settings);
  return parsed.ok ? parsed.settings : defaultAiSettings();
}

export async function saveAiSettings(settings: AiSettings): Promise<void> {
  const parsed = parseAiSettings(settings);
  if (!parsed.ok) throw new Error(parsed.error);
  const result = await window.electronAPI.aiSettings.set(parsed.settings);
  if (!result.success) throw new Error(result.error || 'Could not save assistant settings');
  window.dispatchEvent(new Event(AI_SETTINGS_EVENT));
}

export async function encryptApiKey(plaintext: string): Promise<string> {
  if (!cryptoManager.hasMasterPassword()) {
    throw new Error('Unlock the vault before saving a key');
  }
  return cryptoManager.encrypt(plaintext);
}

export async function decryptApiKey(ciphertext: string): Promise<string> {
  if (!cryptoManager.hasMasterPassword()) {
    throw new Error('Unlock the vault first');
  }
  return cryptoManager.decrypt(ciphertext);
}
