import { useState } from 'react';
import { MASTER_PASSWORD_MIN_LENGTH } from '@magicterm/shared';
import { cryptoManager } from '@magicterm/crypto';
import {
  createServer,
  createServerFolder,
  createSnippet,
  deleteServer,
  deleteServerFolder,
  deleteSnippet,
  getMasterKeyVerifier,
  listServerFolders,
  listServers,
  listSnippets,
  setMasterKeyVerifier,
  toggleServerPin,
  updateServerFolderOrders,
  updateServerOrders,
} from '@magicterm/supabase-client';
import { useAuth } from '../contexts/AuthContext';
import { getLocalDocument } from '../lib/local-vault-session';
import { moveVaultToAccount } from '../lib/move-vault';
import { Button } from './ui/Button';
import { Input } from './ui/Input';

export function MoveVaultPanel() {
  const { login, register, session, finishLocalMove } = useAuth();
  const [email, setEmail] = useState('');
  const [accountPassword, setAccountPassword] = useState('');
  const [sameMasterPassword, setSameMasterPassword] = useState(true);
  const [masterPassword, setMasterPassword] = useState('');
  const [nextMasterPassword, setNextMasterPassword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const signIn = async (create: boolean) => {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      if (create) {
        const result = await register(email, accountPassword);
        if (result.needsConfirmation) {
          setNotice(`Check ${result.email} and confirm the account, then sign in here.`);
        }
      } else {
        await login(email, accountPassword);
      }
      setAccountPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign in');
    } finally {
      setBusy(false);
    }
  };

  const move = async () => {
    setError('');
    setNotice('');
    const local = getLocalDocument();
    if (!local) {
      setError('Unlock the vault first.');
      return;
    }
    const typed = sameMasterPassword ? masterPassword : masterPassword;
    if (!typed) {
      setError('Enter the current master password.');
      return;
    }
    if (!sameMasterPassword && nextMasterPassword.length < MASTER_PASSWORD_MIN_LENGTH) {
      setError(`New master password must be at least ${MASTER_PASSWORD_MIN_LENGTH} characters`);
      return;
    }

    setBusy(true);
    const currentMasterPassword = masterPassword;
    const replacement = nextMasterPassword;
    try {
      const localCheck = await window.electronAPI.masterKey.verify(currentMasterPassword);
      const accountVerifier = await getMasterKeyVerifier();
      let accountPasswordOk = true;
      if (sameMasterPassword && accountVerifier) {
        const accountCheck = await window.electronAPI.masterKey.checkVerifier(currentMasterPassword, accountVerifier);
        accountPasswordOk = accountCheck.success && accountCheck.valid;
      }
      const stored = await window.electronAPI.masterKey.getVerifier();
      const result = await moveVaultToAccount({
        confirmed: true,
        sameMasterPassword,
        localPasswordOk: Boolean(localCheck.success && localCheck.valid),
        accountPasswordOk,
        localVerifier: stored.verifier,
        createNextVerifier: async () => {
          const created = await window.electronAPI.masterKey.createVerifier(replacement);
          if (!created.success || !created.verifier) throw new Error('Could not create the verifier');
          return created.verifier;
        },
        local,
        cloud: {
          listPersonal: async () => ({
            servers: await listServers(),
            folders: await listServerFolders(),
            snippets: await listSnippets(),
          }),
          createFolder: async (folder) => {
            const created = await createServerFolder({ name: folder.name });
            if (folder.sortOrder) {
              await updateServerFolderOrders([{ id: created.id, sort_order: folder.sortOrder }]);
            }
            return created;
          },
          createServer: async (server, folderId) => {
            const created = await createServer({
              name: server.name,
              host: server.host,
              port: server.port,
              username: server.username,
              authType: server.authType,
              connectionType: server.connectionType,
              credentials: server.credentials ?? '',
              comment: server.comment,
              folderId,
            });
            if (server.isPinned) await toggleServerPin(created.id, true);
            if (server.sortOrder) {
              await updateServerOrders([{ id: created.id, sort_order: server.sortOrder }]);
            }
            return created;
          },
          createSnippet: (snippet) => createSnippet({
            name: snippet.name,
            value: snippet.value,
            sortOrder: snippet.sortOrder,
          }),
          removeFolder: deleteServerFolder,
          removeServer: deleteServer,
          removeSnippet: deleteSnippet,
          getVerifier: getMasterKeyVerifier,
          setVerifier: setMasterKeyVerifier,
        },
        crypto: {
          decrypt: (value) => cryptoManager.decrypt(value),
          encrypt: (value) => cryptoManager.encrypt(value),
          useNextPassword: () => cryptoManager.setMasterPassword(replacement),
          restorePassword: () => cryptoManager.setMasterPassword(currentMasterPassword),
        },
        deleteLocalFile: async () => {
          const deleted = await window.electronAPI.localVault.delete();
          if (!deleted.success) throw new Error(deleted.error || 'Could not remove the local vault');
        },
        disableLocalMode: finishLocalMove,
        restoreLocalVerifier: async (verifier) => {
          await window.electronAPI.masterKey.setVerifier(verifier);
        },
      });

      if (!result.ok && result.reason === 'cloud_not_empty') {
        setError('This account already has a vault. Nothing was moved.');
      } else if (!result.ok && result.reason === 'password_rejected') {
        setError('Master password does not match.');
      } else if (!result.ok) {
        setError('Could not upload. The local vault is unchanged.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not upload. The local vault is unchanged.');
    } finally {
      setMasterPassword('');
      setNextMasterPassword('');
      setBusy(false);
    }
  };

  if (!session) {
    return (
      <div className="py-3">
        <p className="text-sm text-fg">This vault stays on this computer.</p>
        <p className="mt-1 text-xs text-fg-subtle">Sign in or create an account, then move it across. Nothing uploads until you confirm.</p>
        <div className="mt-3 space-y-3">
          <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Input label="Password" type="password" value={accountPassword} onChange={(e) => setAccountPassword(e.target.value)} />
        </div>
        {notice && <p className="mt-3 text-sm text-fg-muted">{notice}</p>}
        {error && <p className="mt-3 text-sm text-danger" role="alert">{error}</p>}
        <div className="mt-3 flex gap-2">
          <Button type="button" size="sm" disabled={busy || !email || !accountPassword} onClick={() => { void signIn(false); }}>
            Sign in
          </Button>
          <Button type="button" variant="secondary" size="sm" disabled={busy || !email || !accountPassword} onClick={() => { void signIn(true); }}>
            Create account
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="py-3">
      <p className="text-sm text-fg">Signed in as {session.user.email ?? email}.</p>
      <p className="mt-1 text-xs text-fg-subtle">The vault stays here until you move it.</p>
      <label className="mt-3 flex items-center gap-2 text-sm text-fg">
        <input
          type="checkbox"
          checked={sameMasterPassword}
          onChange={(e) => setSameMasterPassword(e.target.checked)}
        />
        Same master password
      </label>
      <div className="mt-3 space-y-3">
        <Input
          label="Current master password"
          type="password"
          value={masterPassword}
          onChange={(e) => setMasterPassword(e.target.value)}
        />
        {!sameMasterPassword && (
          <Input
            label="New master password"
            type="password"
            value={nextMasterPassword}
            onChange={(e) => setNextMasterPassword(e.target.value)}
          />
        )}
      </div>
      {error && <p className="mt-3 text-sm text-danger" role="alert">{error}</p>}
      <Button type="button" size="sm" className="mt-3" disabled={busy} onClick={() => { void move(); }}>
        Move this vault to the account
      </Button>
    </div>
  );
}
