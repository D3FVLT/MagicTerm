import { useState } from 'react';
import { useOrganizations } from '../contexts/OrganizationsContext';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Select } from './ui/Select';
import type { MemberRole } from '@magicterm/shared';

interface InviteMemberModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function InviteMemberModal({ isOpen, onClose }: InviteMemberModalProps) {
  const { currentOrg, invite } = useOrganizations();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<MemberRole>('member');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!currentOrg) {
      setError('No organization selected');
      return;
    }

    if (!email.trim()) {
      setError('Email is required');
      return;
    }

    setIsLoading(true);
    try {
      await invite({
        orgId: currentOrg.id,
        email: email.trim().toLowerCase(),
        role,
      });
      setEmail('');
      setRole('member');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send invite');
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    setEmail('');
    setRole('member');
    setError('');
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Invite Member">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          type="email"
          label="Email Address"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="colleague@example.com"
          autoFocus
          required
        />

        <Select
          label="Role"
          value={role}
          onChange={(e) => setRole(e.target.value as MemberRole)}
          options={[
            { value: 'admin', label: 'Admin - Full access, can invite others' },
            { value: 'member', label: 'Member - Can add and connect to servers' },
            { value: 'viewer', label: 'Viewer - Can only view servers' },
          ]}
        />

        <div className="rounded-lg bg-gray-800 p-3 text-sm text-gray-400">
          The invited user will receive access once they register or sign in with this email.
        </div>

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
            {isLoading ? 'Sending...' : 'Send Invite'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
