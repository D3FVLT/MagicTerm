import { useState, useEffect } from 'react';
import { useServers } from '../contexts/ServersContext';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Select } from './ui/Select';
import type { Server, AuthType } from '@magicterm/shared';

interface EditServerModalProps {
  isOpen: boolean;
  onClose: () => void;
  server: Server | null;
}

export function EditServerModal({ isOpen, onClose, server }: EditServerModalProps) {
  const { editServer, removeServer, decryptServerHost, decryptServerUsername } = useServers();
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

  useEffect(() => {
    if (server && isOpen) {
      setIsDecrypting(true);
      setName(server.name);
      setPort(String(server.port));
      setAuthType(server.authType);
      setComment(server.comment || '');
      setPassword('');
      setPrivateKey('');
      setError('');
      setShowDeleteConfirm(false);

      Promise.all([
        decryptServerHost(server),
        decryptServerUsername(server),
      ]).then(([decryptedHost, decryptedUsername]) => {
        setHost(decryptedHost);
        setUsername(decryptedUsername);
      }).catch((err) => {
        setError('Failed to decrypt server data: ' + (err instanceof Error ? err.message : 'Unknown error'));
      }).finally(() => {
        setIsDecrypting(false);
      });
    }
  }, [server, isOpen, decryptServerHost, decryptServerUsername]);

  const handleClose = () => {
    setShowDeleteConfirm(false);
    onClose();
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

      const credentials = authType === 'password' ? password : privateKey;
      if (credentials.trim()) {
        updates.credentials = credentials;
      }

      await editServer(server.id, updates);
      handleClose();
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
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete server');
    } finally {
      setIsDeleting(false);
    }
  };

  if (!server) return null;

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Edit Server">
      {isDecrypting ? (
        <div className="flex items-center justify-center py-8">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary-500 border-t-transparent" />
          <span className="ml-3 text-gray-400">Decrypting server data...</span>
        </div>
      ) : (
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="My Server"
          required
        />

        <div className="grid grid-cols-3 gap-4">
          <div className="col-span-2">
            <Input
              label="Host"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="192.168.1.100"
              required
            />
          </div>
          <Input
            label="Port"
            type="number"
            value={port}
            onChange={(e) => setPort(e.target.value)}
            placeholder="22"
            min={1}
            max={65535}
          />
        </div>

        <Input
          label="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="root"
          required
        />

        <Select
          label="Authentication"
          value={authType}
          onChange={(e) => setAuthType(e.target.value as AuthType)}
          options={[
            { value: 'password', label: 'Password' },
            { value: 'key', label: 'Private Key' },
          ]}
        />

        {authType === 'password' ? (
          <Input
            type="password"
            label="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Leave empty to keep current"
          />
        ) : (
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-300">
              Private Key
            </label>
            <textarea
              value={privateKey}
              onChange={(e) => setPrivateKey(e.target.value)}
              placeholder="Leave empty to keep current key"
              rows={5}
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 font-mono text-sm text-white placeholder-gray-500 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
          </div>
        )}

        <Input
          label="Comment"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Optional note about this server"
        />

        {error && (
          <div className="rounded-lg bg-red-500/10 p-3 text-sm text-red-400">
            {error}
          </div>
        )}

        <div className="flex items-center justify-between pt-2">
          <div>
            {!showDeleteConfirm ? (
              <Button 
                type="button" 
                variant="ghost" 
                onClick={() => setShowDeleteConfirm(true)}
                className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
              >
                Delete Server
              </Button>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-sm text-red-400">Delete?</span>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={handleDelete}
                  disabled={isDeleting}
                  className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                >
                  {isDeleting ? 'Deleting...' : 'Yes'}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setShowDeleteConfirm(false)}
                >
                  No
                </Button>
              </div>
            )}
          </div>
          
          <div className="flex gap-3">
            <Button type="button" variant="ghost" onClick={handleClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </div>
      </form>
      )}
    </Modal>
  );
}
