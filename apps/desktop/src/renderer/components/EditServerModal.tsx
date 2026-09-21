import { useState, useEffect } from 'react';
import { useServers } from '../contexts/ServersContext';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { copySecretToClipboard } from '../lib/secret-clipboard';
import type { Server, AuthType } from '@magicterm/shared';

const SECRET_FIELDS = new Set(['password', 'key']);
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

interface EditServerModalProps {
  isOpen: boolean;
  onClose: () => void;
  server: Server | null;
}

export function EditServerModal({ isOpen, onClose, server }: EditServerModalProps) {
  const { editServer, removeServer, folders, decryptServerHost, decryptServerUsername, decryptServerCredentials } = useServers();
  const [isLoading, setIsLoading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [error, setError] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const [name, setName] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('22');
  const [username, setUsername] = useState('');
  const [authType, setAuthType] = useState<AuthType>('password');
  const [password, setPassword] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [comment, setComment] = useState('');
  const [folderId, setFolderId] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [currentCredentials, setCurrentCredentials] = useState('');
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [initialForm, setInitialForm] = useState<{
    name: string;
    host: string;
    port: string;
    username: string;
    authType: AuthType;
    comment: string;
    folderId: string;
  } | null>(null);

  useEffect(() => {
    if (server && isOpen) {
      setIsDecrypting(true);
      setInitialForm(null);
      setName(server.name);
      setPort(String(server.port));
      setAuthType(server.authType);
      setComment(server.comment || '');
      setFolderId(server.folderId || '');
      setPassword('');
      setPrivateKey('');
      setError('');
      setShowDeleteConfirm(false);

      Promise.all([
        decryptServerHost(server),
        decryptServerUsername(server),
        decryptServerCredentials(server),
      ]).then(([decryptedHost, decryptedUsername, decryptedCreds]) => {
        setHost(decryptedHost);
        setUsername(decryptedUsername);
        setCurrentCredentials(decryptedCreds || '');
        setInitialForm({
          name: server.name,
          host: decryptedHost,
          port: String(server.port),
          username: decryptedUsername,
          authType: server.authType,
          comment: server.comment || '',
          folderId: server.folderId || '',
        });
      }).catch((err) => {
        setError('Failed to decrypt server data: ' + (err instanceof Error ? err.message : 'Unknown error'));
      }).finally(() => {
        setIsDecrypting(false);
      });
    }
  }, [server, isOpen, decryptServerHost, decryptServerUsername, decryptServerCredentials]);

  const isDirty =
    initialForm !== null &&
    (name !== initialForm.name ||
      host !== initialForm.host ||
      port !== initialForm.port ||
      username !== initialForm.username ||
      authType !== initialForm.authType ||
      comment !== initialForm.comment ||
      folderId !== initialForm.folderId ||
      Boolean(authType === 'password' ? password : privateKey));

  const handleClose = (force = false) => {
    if (!force && isDirty && !window.confirm('Discard unsaved changes?')) return;
    setShowDeleteConfirm(false);
    setShowPassword(false);
    setCurrentCredentials('');
    setCopiedField(null);
    setInitialForm(null);
    onClose();
  };

  const copyToClipboard = async (text: string, field: string) => {
    if (SECRET_FIELDS.has(field)) {
      await copySecretToClipboard(text);
    } else {
      await window.electronAPI.clipboard.writeText(text);
    }
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!server) return;
    setError('');

    if (!name.trim() || !host.trim() || !username.trim()) {
      setError('Please fill in all required fields');
      return;
    }

    setIsLoading(true);
    try {
      const updates: Record<string, unknown> = {
        name: name.trim(),
        host: host.trim(),
        port: parseInt(port, 10) || 22,
        username: username.trim(),
        authType,
        comment: comment.trim() || null,
      };

      if (folderId !== (initialForm?.folderId ?? '')) {
        updates.folderId = folderId || null;
      }

      const credentials = authType === 'password' ? password : privateKey;
      if (credentials.trim()) {
        updates.credentials = credentials;
      }

      await editServer(server.id, updates);
      handleClose(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update server');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!server) return;
    setIsDeleting(true);
    try {
      await removeServer(server.id);
      handleClose(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete server');
    } finally {
      setIsDeleting(false);
    }
  };

  if (!server) return null;

  const copyButton = (text: string, field: string, label: string) => (
    <button
      type="button"
      onClick={() => { void copyToClipboard(text, field); }}
      className="shrink-0 text-xs text-fg-subtle hover:text-fg"
    >
      {copiedField === field ? 'Copied' : label}
    </button>
  );

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Edit Server" closeOnBackdropClick={false}>
      {isDecrypting ? (
        <p className="py-6 text-[13px] text-fg-subtle">Reading...</p>
      ) : (
      <form onSubmit={handleSubmit} className="-mx-6 -mt-2">
        <Field label="Name" htmlFor="edit-name">
          <input id="edit-name" value={name} onChange={(e) => setName(e.target.value)} required className={controlClass} />
        </Field>
        <Field label="Host" htmlFor="edit-host">
          <div className="flex items-center gap-2">
            <input id="edit-host" value={host} onChange={(e) => setHost(e.target.value)} required className={`${controlClass} min-w-0 flex-1`} />
            {host && copyButton(host, 'host', 'Copy')}
          </div>
        </Field>
        <Field label="Port" htmlFor="edit-port">
          <input id="edit-port" type="number" value={port} onChange={(e) => setPort(e.target.value)} min={1} max={65535} className={controlClass} />
        </Field>
        <Field label="User" htmlFor="edit-user">
          <div className="flex items-center gap-2">
            <input id="edit-user" value={username} onChange={(e) => setUsername(e.target.value)} required className={`${controlClass} min-w-0 flex-1`} />
            {username && copyButton(username, 'username', 'Copy')}
          </div>
        </Field>
        <Field label="Auth" htmlFor="edit-auth">
          <select
            id="edit-auth"
            value={authType}
            onChange={(e) => setAuthType(e.target.value as AuthType)}
            className={controlClass}
          >
            <option value="password">Password</option>
            <option value="key">Private key</option>
          </select>
        </Field>
        {authType === 'password' ? (
          <Field label="Password" htmlFor="edit-password">
            <div className="flex items-center gap-2">
              <input
                id="edit-password"
                type={showPassword ? 'text' : 'password'}
                value={password || (showPassword ? currentCredentials : '')}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={currentCredentials ? 'Leave empty to keep' : ''}
                className={`${controlClass} min-w-0 flex-1`}
              />
              {currentCredentials && copyButton(currentCredentials, 'password', 'Copy')}
              {currentCredentials && (
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="shrink-0 text-xs text-fg-subtle hover:text-fg"
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              )}
            </div>
          </Field>
        ) : (
          <Field label="Private key" htmlFor="edit-key" align="start">
            <div>
              {currentCredentials && (
                <div className="mb-1 flex justify-end">
                  {copyButton(currentCredentials, 'key', 'Copy')}
                </div>
              )}
              <textarea
                id="edit-key"
                value={privateKey}
                onChange={(e) => setPrivateKey(e.target.value)}
                placeholder="Leave empty to keep"
                rows={4}
                className={`${controlClass} font-mono text-xs`}
              />
            </div>
          </Field>
        )}
        <Field label="Comment" htmlFor="edit-comment">
          <input id="edit-comment" value={comment} onChange={(e) => setComment(e.target.value)} className={controlClass} />
        </Field>
        <Field label="Folder" htmlFor="edit-folder">
          <select id="edit-folder" value={folderId} onChange={(e) => setFolderId(e.target.value)} className={controlClass}>
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
            {isLoading ? 'Saving...' : 'Save'}
          </Button>
        </div>

        {showDeleteConfirm ? (
          <div className="mt-4 border-t border-edge px-6 pt-3">
            <p className="text-[13px] text-fg">Delete {server.name}?</p>
            <div className="mt-3 flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setShowDeleteConfirm(false)}>
                Cancel
              </Button>
              <Button type="button" variant="danger" size="sm" onClick={() => { void handleDelete(); }} disabled={isDeleting}>
                {isDeleting ? 'Deleting...' : 'Delete'}
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowDeleteConfirm(true)}
            className="mt-4 px-6 text-left text-[13px] text-fg-subtle hover:text-danger"
          >
            Delete server
          </button>
        )}
      </form>
      )}
    </Modal>
  );
}
