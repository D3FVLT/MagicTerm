import type { LocalVaultDocument } from '@magicterm/shared';

let document: LocalVaultDocument | null = null;

export function setLocalDocument(next: LocalVaultDocument | null): void {
  document = next;
}

export function getLocalDocument(): LocalVaultDocument | null {
  return document;
}

export function clearLocalDocument(): void {
  document = null;
}

export async function mutateLocalDocument(
  mutate: (draft: LocalVaultDocument) => void
): Promise<LocalVaultDocument> {
  if (!document) throw new Error('Vault is locked');
  const draft = structuredClone(document);
  mutate(draft);
  const result = await window.electronAPI.localVault.replace(draft);
  if (!result.success) throw new Error(result.error || 'Could not save the vault');
  document = draft;
  return draft;
}
