import { useState } from 'react';
import { useOrganizations } from '../contexts/OrganizationsContext';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { Input } from './ui/Input';

interface CreateOrgModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function CreateOrgModal({ isOpen, onClose }: CreateOrgModalProps) {
  const { createOrg, setCurrentOrg } = useOrganizations();
  const [name, setName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!name.trim()) {
      setError('Organization name is required');
      return;
    }

    setIsLoading(true);
    try {
      const org = await createOrg({ name: name.trim() });
      setCurrentOrg({ ...org, role: 'owner' });
      setName('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create organization');
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    setName('');
    setError('');
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Create Organization">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Organization Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="My Team"
          autoFocus
          required
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
            {isLoading ? 'Creating...' : 'Create'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
