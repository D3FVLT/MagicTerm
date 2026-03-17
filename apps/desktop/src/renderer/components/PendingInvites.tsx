import { useState } from 'react';
import { useOrganizations } from '../contexts/OrganizationsContext';
import { Button } from './ui/Button';

export function PendingInvites() {
  const { pendingInvites, accept, decline } = useOrganizations();
  const [loadingId, setLoadingId] = useState<string | null>(null);

  if (pendingInvites.length === 0) {
    return null;
  }

  const handleAccept = async (id: string) => {
    setLoadingId(id);
    try {
      await accept(id);
    } finally {
      setLoadingId(null);
    }
  };

  const handleDecline = async (id: string) => {
    setLoadingId(id);
    try {
      await decline(id);
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <div className="border-b border-gray-800 p-4">
      <h3 className="mb-3 text-sm font-medium text-gray-400">Pending Invites</h3>
      <div className="space-y-2">
        {pendingInvites.map((invite) => (
          <div
            key={invite.id}
            className="rounded-lg bg-gray-800 p-3"
          >
            <div className="mb-2 text-sm text-gray-300">
              You've been invited to join an organization as{' '}
              <span className="font-medium text-primary-400">{invite.role}</span>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => handleAccept(invite.id)}
                disabled={loadingId === invite.id}
              >
                Accept
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => handleDecline(invite.id)}
                disabled={loadingId === invite.id}
              >
                Decline
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
