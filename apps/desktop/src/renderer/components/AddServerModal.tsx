import { useState } from 'react';
import { useServers } from '../contexts/ServersContext';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Select } from './ui/Select';
import type { AuthType } from '@magicterm/shared';

interface AddServerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AddServerModal({ isOpen, onClose }: AddServerModalProps) {
  const { addServer } = useServers();
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

  const resetForm = () => {
    setName('');
    setHost('');
    setPort('22');
    setUsername('');
    setAuthType('password');
    setPassword('');
    setPrivateKey('');
    setComment('');
    setError('');
  };

  const handleClose = () => {
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
      });
      handleClose();
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
      setComment(`Key: ${h.identityFile}`);
    }
    setShowImport(false);
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Add Server">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={handleImport}
            disabled={importLoading}
            className="flex items-center gap-1.5 rounded-lg border border-[#414868] px-2.5 py-1.5 text-xs text-[#7aa2f7] transition-colors hover:bg-[#292e42] disabled:opacity-50"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            {importLoading ? 'Reading...' : 'Import from ~/.ssh/config'}
          </button>
        </div>

        {showImport && importHosts.length > 0 && (
          <div className="max-h-32 space-y-1 overflow-y-auto rounded-lg border border-[#292e42] bg-[#1a1b26] p-2">
            {importHosts.map((h, i) => (
              <button
                key={i}
                type="button"
                onClick={() => fillFromImport(h)}
                className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs text-[#c0caf5] hover:bg-[#292e42]"
              >
                <span className="font-medium">{h.name}</span>
                <span className="text-[#565f89]">{h.username}@{h.host}:{h.port}</span>
              </button>
            ))}
          </div>
        )}

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
            placeholder="••••••••"
            required
          />
        ) : (
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-300">
              Private Key
            </label>
            <textarea
              value={privateKey}
              onChange={(e) => setPrivateKey(e.target.value)}
              placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
              rows={5}
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 font-mono text-sm text-white placeholder-gray-500 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              required
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

        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="ghost" onClick={handleClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={isLoading}>
            {isLoading ? 'Adding...' : 'Add Server'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
