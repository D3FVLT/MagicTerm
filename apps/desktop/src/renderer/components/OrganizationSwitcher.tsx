import { useState } from 'react';
import { useOrganizations } from '../contexts/OrganizationsContext';
import { CreateOrgModal } from './CreateOrgModal';
import type { OrganizationWithRole } from '@magicterm/shared';

interface OrganizationSwitcherProps {
  onSelect?: () => void;
  onShowInvites?: () => void;
}

function Check({ on }: { on: boolean }) {
  return (
    <span className="flex h-4 w-4 shrink-0 items-center justify-center text-accent">
      {on && (
        <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
        </svg>
      )}
    </span>
  );
}

export function OrganizationSwitcher({ onSelect, onShowInvites }: OrganizationSwitcherProps) {
  const { organizations, currentOrg, setCurrentOrg, pendingInvites } = useOrganizations();
  const [isOpen, setIsOpen] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const handleSelect = (org: OrganizationWithRole | null) => {
    setCurrentOrg(org);
    setIsOpen(false);
    onSelect?.();
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        className="flex h-8 w-full items-center justify-between gap-2 rounded-md px-1 text-left text-[13px] hover:bg-surface-2"
      >
        <span className="truncate text-fg">
          {currentOrg ? currentOrg.name : 'Personal'}
        </span>
        <svg
          className={`h-4 w-4 shrink-0 text-fg-subtle transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div
            role="menu"
            className="animate-slide-down absolute left-0 top-full z-50 mt-1 w-full min-w-[220px] rounded-lg border border-edge bg-surface-1 py-1 shadow-xl"
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => handleSelect(null)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-surface-2"
            >
              <Check on={!currentOrg} />
              <span className="truncate text-fg">Personal</span>
            </button>

            {organizations.map((org) => (
              <button
                key={org.id}
                type="button"
                role="menuitem"
                onClick={() => handleSelect(org)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-surface-2"
              >
                <Check on={currentOrg?.id === org.id} />
                <span className="min-w-0 flex-1 truncate text-fg">{org.name}</span>
                <span className="shrink-0 text-xs text-fg-subtle">{org.role}</span>
              </button>
            ))}

            <div className="my-1 border-t border-edge" />

            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setIsOpen(false);
                onShowInvites?.();
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-surface-2"
            >
              <Check on={false} />
              <span className="flex-1 text-fg">Invites</span>
              <span className="tabular-nums text-xs text-fg-subtle">{pendingInvites.length}</span>
            </button>

            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setIsOpen(false);
                setShowCreateModal(true);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-fg hover:bg-surface-2"
            >
              <Check on={false} />
              Create organization
            </button>
          </div>
        </>
      )}

      <CreateOrgModal isOpen={showCreateModal} onClose={() => setShowCreateModal(false)} />
    </div>
  );
}
