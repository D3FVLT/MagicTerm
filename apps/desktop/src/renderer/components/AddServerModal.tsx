import { useState } from 'react';
import { useServers } from '../contexts/ServersContext';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Select } from './ui/Select';
import type { AuthType, ConnectionType } from '@magicterm/shared';

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
  const [connectionType, setConnectionType] = useState<ConnectionType>('ssh');
  const [authType, setAuthType] = useState<AuthType>('password');
  const [password, setPassword] = useState('');
  const [privateKey, setPrivateKey] = useState('');

  const resetForm = () => {
    setName('');
    setHost('');
    setPort('22');
    setUsername('');
    setConnectionType('ssh');
    setAuthType('password');
    setPassword('');
    setPrivateKey('');
    setError('');
  };

  const handleConnectionTypeChange = (type: ConnectionType) => {
    setConnectionType(type);
    if (type === 'ftp') {
      setPort('21');
      setAuthType('password');
    } else if (type === 'sftp') {
      setPort('22');
    } else {
      setPort('22');
    }
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
        connectionType,
        authType,
        credentials,
      });
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add server');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Add Server">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="My Server"
          required
        />

        <Select
          label="Connection Type"
          value={connectionType}
          onChange={(e) => handleConnectionTypeChange(e.target.value as ConnectionType)}
          options={[
            { value: 'ssh', label: 'SSH' },
            { value: 'sftp', label: 'SFTP' },
            { value: 'ftp', label: 'FTP' },
          ]}
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
            placeholder={connectionType === 'ftp' ? '21' : '22'}
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

        {connectionType !== 'ftp' && (
          <Select
            label="Authentication"
            value={authType}
            onChange={(e) => setAuthType(e.target.value as AuthType)}
            options={[
              { value: 'password', label: 'Password' },
              { value: 'key', label: 'Private Key' },
            ]}
          />
        )}

        {authType === 'password' || connectionType === 'ftp' ? (
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
