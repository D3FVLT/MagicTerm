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
    <div id="vault-invites" className="border-b border-edge py-2">
      <p className="px-2 py-1 text-xs text-fg-subtle">Pending invites</p>
      {pendingInvites.map((invite) => (
        <div key={invite.id} className="flex h-9 items-center gap-3 px-2">
          <span className="min-w-0 flex-1 truncate text-[13px] text-fg">
            Join as {invite.role}
          </span>
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
      ))}
    </div>
  );
}
