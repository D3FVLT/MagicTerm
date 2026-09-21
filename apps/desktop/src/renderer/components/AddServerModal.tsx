import { useState } from 'react';
import { useServers } from '../contexts/ServersContext';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import type { AuthType } from '@magicterm/shared';

interface AddServerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const controlClass = 'w-full bg-transparent text-[13px] text-fg outline-none placeholder:text-fg-subtle';

function Field({
  label,
  htmlFor,
  align = 'center',
  children,
}: {
  label: string;
  htmlFor?: string;
  align?: 'center' | 'start';
  children: React.ReactNode;
}) {
  return (
    <div className={`flex gap-4 border-b border-edge px-6 py-2 ${align === 'start' ? 'items-start' : 'items-center'}`}>
      <label htmlFor={htmlFor} className={`w-28 shrink-0 text-[13px] text-fg-subtle ${align === 'start' ? 'pt-1' : ''}`}>
        {label}
      </label>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function AddServerModal({ isOpen, onClose }: AddServerModalProps) {
  const { addServer, folders } = useServers();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const [name, setName] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('22');
  const [username, setUsername] = useState('');
  const [authType, setAuthType] = useState<AuthType>('password');
  const [password, setPassword] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [comment, setComment] = useState('');
  const [folderId, setFolderId] = useState('');

  const resetForm = () => {
    setName('');
    setHost('');
    setPort('22');
    setUsername('');
    setAuthType('password');
    setPassword('');
    setPrivateKey('');
    setComment('');
    setFolderId('');
    setError('');
  };

  const isDirty =
    Boolean(name.trim()) ||
    Boolean(host.trim()) ||
    Boolean(username.trim()) ||
    Boolean(password) ||
    Boolean(privateKey) ||
    Boolean(comment.trim()) ||
    Boolean(folderId) ||
    port !== '22' ||
    authType !== 'password';

  const handleClose = (force = false) => {
    if (!force && isDirty && !window.confirm('Discard unsaved changes?')) return;
    resetForm();
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!name.trim() || !host.trim() || !username.trim()) {
      setError('Please fill in all required fields');
      return;
    }

    const credentials = authType === 'password' ? password : privateKey;
    if (!credentials.trim()) {
      setError(authType === 'password' ? 'Password is required' : 'Private key is required');
      return;
    }

    setIsLoading(true);
    try {
      await addServer({
        name: name.trim(),
        host: host.trim(),
        port: parseInt(port, 10) || 22,
        username: username.trim(),
        connectionType: 'ssh',
        authType,
        credentials,
        comment: comment.trim() || undefined,
        folderId: folderId || null,
      });
      handleClose(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add server');
    } finally {
      setIsLoading(false);
    }
  };

  const [showImport, setShowImport] = useState(false);
  const [importHosts, setImportHosts] = useState<{ name: string; host: string; port: number; username: string; identityFile?: string }[]>([]);
  const [importLoading, setImportLoading] = useState(false);

  const handleImport = async () => {
    setImportLoading(true);
    try {
      const result = await window.electronAPI.sshConfig.import();
      if (result.success && result.hosts.length > 0) {
        setImportHosts(result.hosts);
        setShowImport(true);
      } else if (result.hosts.length === 0) {
        setError('No hosts found in ~/.ssh/config');
      } else {
        setError(result.error || 'Failed to read SSH config');
      }
    } catch {
      setError('Failed to read SSH config');
    } finally {
      setImportLoading(false);
    }
  };

  const fillFromImport = (h: typeof importHosts[0]) => {
    setName(h.name);
    setHost(h.host);
    setPort(String(h.port));
    setUsername(h.username);
    if (h.identityFile) {
      setAuthType('key');
      // Don't leak the local IdentityFile path into the cloud-synced
      // (but plaintext) `comment` column. The path is private to the
      // local machine; storing it in plaintext on Supabase exposes the
      // user's directory layout / username without adding any value.
    }
    setShowImport(false);
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Add Server" closeOnBackdropClick={false}>
      <form onSubmit={handleSubmit} className="-mx-6 -mt-2">
        <button
          type="button"
          onClick={() => { void handleImport(); }}
          disabled={importLoading}
          className="flex h-9 w-full items-center border-b border-edge px-6 text-left text-[13px] text-fg-subtle hover:text-fg disabled:opacity-50"
        >
          {importLoading ? 'Reading...' : 'Import from ~/.ssh/config'}
        </button>

        {showImport && importHosts.length > 0 && (
          <div className="max-h-40 overflow-y-auto">
            {importHosts.map((h, i) => (
              <button
                key={i}
                type="button"
                onClick={() => fillFromImport(h)}
                className="flex h-9 w-full items-center justify-between gap-3 border-b border-edge px-6 text-left text-[13px] hover:bg-surface-1"
              >
                <span className="truncate text-fg">{h.name}</span>
                <span className="truncate text-xs text-fg-subtle">{h.username}@{h.host}:{h.port}</span>
              </button>
            ))}
          </div>
        )}

        <Field label="Name" htmlFor="add-name">
          <input id="add-name" value={name} onChange={(e) => setName(e.target.value)} required className={controlClass} />
        </Field>
        <Field label="Host" htmlFor="add-host">
          <input id="add-host" value={host} onChange={(e) => setHost(e.target.value)} required className={controlClass} />
        </Field>
        <Field label="Port" htmlFor="add-port">
          <input id="add-port" type="number" value={port} onChange={(e) => setPort(e.target.value)} min={1} max={65535} className={controlClass} />
        </Field>
        <Field label="User" htmlFor="add-user">
          <input id="add-user" value={username} onChange={(e) => setUsername(e.target.value)} required className={controlClass} />
        </Field>
        <Field label="Auth" htmlFor="add-auth">
          <select
            id="add-auth"
            value={authType}
            onChange={(e) => setAuthType(e.target.value as AuthType)}
            className={controlClass}
          >
            <option value="password">Password</option>
            <option value="key">Private key</option>
          </select>
        </Field>
        {authType === 'password' ? (
          <Field label="Password" htmlFor="add-password">
            <input id="add-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required className={controlClass} />
          </Field>
        ) : (
          <Field label="Private key" htmlFor="add-key" align="start">
            <textarea
              id="add-key"
              value={privateKey}
              onChange={(e) => setPrivateKey(e.target.value)}
              rows={4}
              required
              className={`${controlClass} font-mono text-xs`}
            />
          </Field>
        )}
        <Field label="Comment" htmlFor="add-comment">
          <input id="add-comment" value={comment} onChange={(e) => setComment(e.target.value)} className={controlClass} />
        </Field>
        <Field label="Folder" htmlFor="add-folder">
          <select id="add-folder" value={folderId} onChange={(e) => setFolderId(e.target.value)} className={controlClass}>
            <option value="">Ungrouped</option>
            {folders.map((folder) => (
              <option key={folder.id} value={folder.id}>{folder.name}</option>
            ))}
          </select>
        </Field>

        {error && <p className="px-6 pt-3 text-[13px] text-danger">{error}</p>}

        <div className="flex justify-end gap-2 px-6 pt-4">
          <Button type="button" variant="ghost" size="sm" onClick={() => handleClose()}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={isLoading}>
            {isLoading ? 'Adding...' : 'Add'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
