import { useState } from 'react';
import { useOrganizations } from '../contexts/OrganizationsContext';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';

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
      setError('Name is required');
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
    <Modal isOpen={isOpen} onClose={handleClose} title="Create organization">
      <form onSubmit={handleSubmit}>
        <label htmlFor="org-name" className="mb-1 block text-xs text-fg-subtle">Name</label>
        <input
          id="org-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          required
          className="w-full border-b border-edge bg-transparent py-1 text-[13px] text-fg outline-none focus:border-accent"
        />
        {error && <p className="mt-2 text-[13px] text-danger">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={handleClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={isLoading}>
            {isLoading ? 'Creating...' : 'Create'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
