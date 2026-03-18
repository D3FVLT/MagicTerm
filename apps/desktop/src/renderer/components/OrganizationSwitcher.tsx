import { useState } from 'react';
import { useOrganizations } from '../contexts/OrganizationsContext';
import { Button } from './ui/Button';
import { CreateOrgModal } from './CreateOrgModal';
import type { OrganizationWithRole } from '@magicterm/shared';

interface OrganizationSwitcherProps {
  onSelect?: () => void;
}

export function OrganizationSwitcher({ onSelect }: OrganizationSwitcherProps) {
  const { organizations, currentOrg, setCurrentOrg, pendingInvites, deleteOrg } = useOrganizations();
  const [isOpen, setIsOpen] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [deletingOrg, setDeletingOrg] = useState<OrganizationWithRole | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleSelect = (org: OrganizationWithRole | null) => {
    setCurrentOrg(org);
    setIsOpen(false);
    onSelect?.();
  };

  const handleDeleteOrg = async () => {
    if (!deletingOrg || deleteConfirmText !== deletingOrg.name) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await deleteOrg(deletingOrg.id);
      setDeletingOrg(null);
      setDeleteConfirmText('');
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete');
    } finally {
      setIsDeleting(false);
    }
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
              <div
                key={org.id}
                className={`group/org flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-gray-800 ${
                  currentOrg?.id === org.id ? 'bg-gray-800' : ''
                }`}
              >
                <button
                  onClick={() => handleSelect(org)}
                  className="flex flex-1 items-center gap-2 text-left min-w-0"
                >
                  <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded bg-primary-500/20 text-xs font-medium text-primary-400">
                    {org.name[0].toUpperCase()}
                  </div>
                  <div className="flex-1 truncate">
                    <span className="text-gray-200">{org.name}</span>
                    <span className="ml-2 text-xs text-gray-500">{org.role}</span>
                  </div>
                </button>
                {org.role === 'owner' && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsOpen(false);
                      setDeletingOrg(org);
                      setDeleteConfirmText('');
                      setDeleteError(null);
                    }}
                    className="flex-shrink-0 rounded p-1 text-gray-500 opacity-0 group-hover/org:opacity-100 hover:text-red-400 transition-all"
                    title="Delete organization"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                )}
              </div>
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

      {/* Delete confirmation modal */}
      {deletingOrg && (
        <>
          <div className="fixed inset-0 z-50 bg-black/60" onClick={() => setDeletingOrg(null)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="w-full max-w-md rounded-xl border border-gray-700 bg-gray-900 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="mb-4 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-500/10">
                  <svg className="h-5 w-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-100">Delete Organization</h3>
                  <p className="text-sm text-gray-400">This action cannot be undone</p>
                </div>
              </div>

              <p className="mb-4 text-sm text-gray-300">
                This will permanently delete <strong className="text-white">{deletingOrg.name}</strong>, all its servers and member associations.
              </p>

              <p className="mb-2 text-sm text-gray-400">
                Type <strong className="text-white">{deletingOrg.name}</strong> to confirm:
              </p>
              <input
                type="text"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleDeleteOrg()}
                placeholder={deletingOrg.name}
                className="mb-4 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                autoFocus
              />

              {deleteError && (
                <p className="mb-4 text-sm text-red-400">{deleteError}</p>
              )}

              <div className="flex justify-end gap-3">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDeletingOrg(null)}
                  disabled={isDeleting}
                >
                  Cancel
                </Button>
                <button
                  onClick={handleDeleteOrg}
                  disabled={deleteConfirmText !== deletingOrg.name || isDeleting}
                  className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isDeleting ? 'Deleting...' : 'Delete Organization'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
