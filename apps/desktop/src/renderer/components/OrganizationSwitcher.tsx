import { useState } from 'react';
import { useOrganizations } from '../contexts/OrganizationsContext';
import { Button } from './ui/Button';
import { CreateOrgModal } from './CreateOrgModal';
import type { OrganizationWithRole } from '@magicterm/shared';

interface OrganizationSwitcherProps {
  onSelect?: () => void;
}

export function OrganizationSwitcher({ onSelect }: OrganizationSwitcherProps) {
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
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between rounded-lg bg-gray-800 px-3 py-2 text-left text-sm hover:bg-gray-750"
      >
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded bg-primary-500/20 text-xs font-medium text-primary-400">
            {currentOrg ? currentOrg.name[0].toUpperCase() : 'P'}
          </div>
          <span className="truncate text-gray-200">
            {currentOrg ? currentOrg.name : 'Personal'}
          </span>
        </div>
        <svg
          className={`h-4 w-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
        {pendingInvites.length > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-xs text-white">
            {pendingInvites.length}
          </span>
        )}
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />
          <div className="absolute left-0 right-0 top-full z-20 mt-1 rounded-lg border border-gray-700 bg-gray-900 py-1 shadow-xl">
            <button
              onClick={() => handleSelect(null)}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-800 ${
                !currentOrg ? 'bg-gray-800' : ''
              }`}
            >
              <div className="flex h-6 w-6 items-center justify-center rounded bg-gray-700 text-xs">
                P
              </div>
              <span className="text-gray-200">Personal</span>
            </button>

            {organizations.length > 0 && (
              <div className="my-1 border-t border-gray-800" />
            )}

            {organizations.map((org) => (
              <button
                key={org.id}
                onClick={() => handleSelect(org)}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-800 ${
                  currentOrg?.id === org.id ? 'bg-gray-800' : ''
                }`}
              >
                <div className="flex h-6 w-6 items-center justify-center rounded bg-primary-500/20 text-xs font-medium text-primary-400">
                  {org.name[0].toUpperCase()}
                </div>
                <div className="flex-1 truncate">
                  <span className="text-gray-200">{org.name}</span>
                  <span className="ml-2 text-xs text-gray-500">{org.role}</span>
                </div>
              </button>
            ))}

            <div className="my-1 border-t border-gray-800" />

            <button
              onClick={() => {
                setIsOpen(false);
                setShowCreateModal(true);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-primary-400 hover:bg-gray-800"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Create Organization
            </button>
          </div>
        </>
      )}

      <CreateOrgModal isOpen={showCreateModal} onClose={() => setShowCreateModal(false)} />
    </div>
  );
}
