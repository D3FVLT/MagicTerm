import { useState, useEffect } from 'react';
import { Modal } from './ui/Modal';
import { Input } from './ui/Input';
import { Button } from './ui/Button';
import { Select } from './ui/Select';
import { useOrganizations } from '../contexts/OrganizationsContext';
import { getUserSettings, updateUserSettings } from '@magicterm/supabase-client';
import type { UserSettings } from '@magicterm/shared';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const { organizations } = useOrganizations();
  const [settings, setSettings] = useState<UserSettings>({ nickname: null, defaultOrgId: null });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    const loadSettings = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const userSettings = await getUserSettings();
        setSettings(userSettings);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setIsLoading(false);
      }
    };

    loadSettings();
  }, [isOpen]);

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    setSuccess(false);
    try {
      await updateUserSettings(settings);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const workspaceOptions = [
    { value: '', label: 'Personal (default)' },
    ...organizations.map((org) => ({ value: org.id, label: org.name })),
  ];

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Settings">
      <div className="space-y-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#7aa2f7] border-t-transparent" />
          </div>
        ) : (
          <>
            <div>
              <h3 className="mb-4 text-sm font-medium text-[#c0caf5]">Profile</h3>
              <div className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-sm text-[#a9b1d6]">
                    Nickname
                  </label>
                  <Input
                    value={settings.nickname || ''}
                    onChange={(e) => setSettings({ ...settings, nickname: e.target.value })}
                    placeholder="Enter your nickname (shown instead of email)"
                  />
                  <p className="mt-1 text-xs text-[#565f89]">
                    Your nickname will be displayed to other team members instead of your email address.
                  </p>
                </div>
              </div>
            </div>

            <div className="border-t border-[#292e42] pt-6">
              <h3 className="mb-4 text-sm font-medium text-[#c0caf5]">Workspace</h3>
              <div className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-sm text-[#a9b1d6]">
                    Default Workspace
                  </label>
                  <Select
                    value={settings.defaultOrgId || ''}
                    onChange={(e) => setSettings({ ...settings, defaultOrgId: e.target.value || null })}
                    options={workspaceOptions}
                  />
                  <p className="mt-1 text-xs text-[#565f89]">
                    This workspace will be selected automatically when you open the app.
                  </p>
                </div>
              </div>
            </div>

            {error && (
              <div className="rounded-lg bg-red-500/10 p-3 text-sm text-red-400">
                {error}
              </div>
            )}

            {success && (
              <div className="rounded-lg bg-green-500/10 p-3 text-sm text-green-400">
                Settings saved successfully!
              </div>
            )}

            <div className="flex justify-end gap-3 border-t border-[#292e42] pt-4">
              <Button variant="secondary" onClick={onClose}>
                Close
              </Button>
              <Button onClick={handleSave} disabled={isSaving}>
                {isSaving ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
