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
  const { editServer, removeServer, decryptServerHost, decryptServerUsername, decryptServerCredentials } = useServers();
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
  const [showPassword, setShowPassword] = useState(false);
  const [currentCredentials, setCurrentCredentials] = useState('');
  const [copiedField, setCopiedField] = useState<string | null>(null);

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
        decryptServerCredentials(server),
      ]).then(([decryptedHost, decryptedUsername, decryptedCreds]) => {
        setHost(decryptedHost);
        setUsername(decryptedUsername);
        setCurrentCredentials(decryptedCreds || '');
      }).catch((err) => {
        setError('Failed to decrypt server data: ' + (err instanceof Error ? err.message : 'Unknown error'));
      }).finally(() => {
        setIsDecrypting(false);
      });
    }
  }, [server, isOpen, decryptServerHost, decryptServerUsername]);

  const handleClose = () => {
    setShowDeleteConfirm(false);
    setShowPassword(false);
    setCurrentCredentials('');
    setCopiedField(null);
    onClose();
  };

  const copyToClipboard = (text: string, field: string) => {
    window.electronAPI.clipboard.writeText(text);
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
          <div className="col-span-2 space-y-1">
            <label className="block text-sm font-medium text-gray-300">Host</label>
            <div className="relative">
              <input
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="192.168.1.100"
                required
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 pr-9 text-white placeholder-gray-500 transition-colors focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
              {host && (
                <button
                  type="button"
                  onClick={() => copyToClipboard(host, 'host')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-gray-500 hover:text-gray-300 transition-colors"
                  title="Copy host"
                >
                  {copiedField === 'host' ? (
                    <svg className="h-4 w-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  )}
                </button>
              )}
            </div>
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

        <div className="space-y-1">
          <label className="block text-sm font-medium text-gray-300">Username</label>
          <div className="relative">
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="root"
              required
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 pr-9 text-white placeholder-gray-500 transition-colors focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
            {username && (
              <button
                type="button"
                onClick={() => copyToClipboard(username, 'username')}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-gray-500 hover:text-gray-300 transition-colors"
                title="Copy username"
              >
                {copiedField === 'username' ? (
                  <svg className="h-4 w-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012-2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                )}
              </button>
            )}
          </div>
        </div>

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
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-300">Password</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password || (showPassword ? currentCredentials : '')}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={currentCredentials ? 'Leave empty to keep current' : 'Enter password'}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 pr-16 text-white placeholder-gray-500 transition-colors focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
              {currentCredentials && (
                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => copyToClipboard(currentCredentials, 'password')}
                    className="rounded p-1 text-gray-500 hover:text-gray-300 transition-colors"
                    title="Copy current password"
                  >
                    {copiedField === 'password' ? (
                      <svg className="h-4 w-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="rounded p-1 text-gray-500 hover:text-gray-300 transition-colors"
                    title={showPassword ? 'Hide password' : 'Show current password'}
                  >
                    {showPassword ? (
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L6.59 6.59m7.532 7.532l3.29 3.29M3 3l18 18" />
                      </svg>
                    ) : (
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    )}
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-sm font-medium text-gray-300">
                Private Key
              </label>
              {currentCredentials && (
                <button
                  type="button"
                  onClick={() => copyToClipboard(currentCredentials, 'key')}
                  className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors"
                >
                  {copiedField === 'key' ? (
                    <>
                      <svg className="h-3 w-3 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      <span className="text-green-400">Copied</span>
                    </>
                  ) : (
                    <>
                      <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      <span>Copy current key</span>
                    </>
                  )}
                </button>
              )}
            </div>
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
