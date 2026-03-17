import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import type { Organization, OrganizationInput, OrgMember, InviteMemberInput, MemberRole, OrganizationWithRole } from '@magicterm/shared';
import {
  listOrganizations,
  createOrganization,
  updateOrganization,
  deleteOrganization,
  listOrgMembers,
  inviteMember,
  acceptInvite,
  declineInvite,
  updateMemberRole,
  removeMember,
  getPendingInvites,
  subscribeToOrgMembers,
  getUserSettings,
  updateUserSettings,
} from '@magicterm/supabase-client';

interface OrganizationsContextValue {
  organizations: OrganizationWithRole[];
  currentOrg: OrganizationWithRole | null;
  pendingInvites: OrgMember[];
  members: OrgMember[];
  isLoading: boolean;
  error: string | null;
  
  setCurrentOrg: (org: OrganizationWithRole | null) => void;
  refreshOrganizations: () => Promise<void>;
  
  createOrg: (input: OrganizationInput) => Promise<Organization>;
  updateOrg: (id: string, input: Partial<OrganizationInput>) => Promise<Organization>;
  deleteOrg: (id: string) => Promise<void>;
  
  invite: (input: InviteMemberInput) => Promise<OrgMember>;
  accept: (memberId: string) => Promise<void>;
  decline: (memberId: string) => Promise<void>;
  changeRole: (memberId: string, role: MemberRole) => Promise<void>;
  remove: (memberId: string) => Promise<void>;
}

const OrganizationsContext = createContext<OrganizationsContextValue | null>(null);

export function useOrganizations() {
  const context = useContext(OrganizationsContext);
  if (!context) {
    throw new Error('useOrganizations must be used within an OrganizationsProvider');
  }
  return context;
}

interface OrganizationsProviderProps {
  children: ReactNode;
}

export function OrganizationsProvider({ children }: OrganizationsProviderProps) {
  const [organizations, setOrganizations] = useState<OrganizationWithRole[]>([]);
  const [currentOrg, setCurrentOrg] = useState<OrganizationWithRole | null>(null);
  const [pendingInvites, setPendingInvites] = useState<OrgMember[]>([]);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasInitialized, setHasInitialized] = useState(false);

  const refreshOrganizations = useCallback(async (isInitialLoad = false) => {
    try {
      setIsLoading(true);
      setError(null);
      const [orgs, invites, settings] = await Promise.all([
        listOrganizations(),
        getPendingInvites(),
        getUserSettings(),
      ]);
      setOrganizations(orgs);
      setPendingInvites(invites);
      
      // Only apply default org on initial load, not when user explicitly switches
      if (isInitialLoad && settings.defaultOrgId) {
        const defaultOrg = orgs.find(o => o.id === settings.defaultOrgId);
        if (defaultOrg) {
          setCurrentOrg(defaultOrg);
        } else {
          // Default org no longer accessible (kicked), reset setting
          await updateUserSettings({ defaultOrgId: null });
        }
      }
      
      // Always check if current org is still accessible (user might have been kicked)
      if (currentOrg) {
        const stillMember = orgs.find(o => o.id === currentOrg.id);
        if (!stillMember) {
          setCurrentOrg(null);
          if (settings.defaultOrgId === currentOrg.id) {
            await updateUserSettings({ defaultOrgId: null });
          }
        }
      }
    } catch (err) {
      console.error('Failed to load organizations:', err);
      setError(err instanceof Error ? err.message : 'Failed to load organizations');
    } finally {
      setIsLoading(false);
    }
  }, [currentOrg]);

  useEffect(() => {
    if (!hasInitialized) {
      refreshOrganizations(true);
      setHasInitialized(true);
    }
  }, [hasInitialized, refreshOrganizations]);

  useEffect(() => {
    if (!currentOrg) {
      setMembers([]);
      return;
    }

    let unsubscribe: (() => void) | undefined;

    const loadMembers = async () => {
      try {
        const memberList = await listOrgMembers(currentOrg.id);
        setMembers(memberList);
      } catch (err) {
        console.error('Failed to load members:', err);
      }
    };

    loadMembers();
    unsubscribe = subscribeToOrgMembers(currentOrg.id, setMembers);

    return () => {
      unsubscribe?.();
    };
  }, [currentOrg]);

  const createOrg = async (input: OrganizationInput): Promise<Organization> => {
    const org = await createOrganization(input);
    await refreshOrganizations();
    return org;
  };

  const updateOrg = async (id: string, input: Partial<OrganizationInput>): Promise<Organization> => {
    const org = await updateOrganization(id, input);
    await refreshOrganizations();
    return org;
  };

  const deleteOrg = async (id: string): Promise<void> => {
    await deleteOrganization(id);
    if (currentOrg?.id === id) {
      setCurrentOrg(null);
    }
    await refreshOrganizations();
  };

  const invite = async (input: InviteMemberInput): Promise<OrgMember> => {
    const member = await inviteMember(input);
    if (currentOrg?.id === input.orgId) {
      setMembers((prev) => [...prev, member]);
    }
    return member;
  };

  const accept = async (memberId: string): Promise<void> => {
    await acceptInvite(memberId);
    await refreshOrganizations();
  };

  const decline = async (memberId: string): Promise<void> => {
    await declineInvite(memberId);
    setPendingInvites((prev) => prev.filter((i) => i.id !== memberId));
  };

  const changeRole = async (memberId: string, role: MemberRole): Promise<void> => {
    const updated = await updateMemberRole(memberId, role);
    setMembers((prev) => prev.map((m) => (m.id === memberId ? updated : m)));
  };

  const remove = async (memberId: string): Promise<void> => {
    await removeMember(memberId);
    setMembers((prev) => prev.filter((m) => m.id !== memberId));
  };

  const value: OrganizationsContextValue = {
    organizations,
    currentOrg,
    pendingInvites,
    members,
    isLoading,
    error,
    setCurrentOrg,
    refreshOrganizations,
    createOrg,
    updateOrg,
    deleteOrg,
    invite,
    accept,
    decline,
    changeRole,
    remove,
  };

  return (
    <OrganizationsContext.Provider value={value}>
      {children}
    </OrganizationsContext.Provider>
  );
}
