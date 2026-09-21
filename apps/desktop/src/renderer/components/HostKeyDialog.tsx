import { useEffect, useState } from 'react';
import type { HostKeyChallenge } from '../types/electron';
import { Button } from './ui/Button';

interface HostKeyDialogProps {
  challenge: HostKeyChallenge | null;
  onTrust: () => void;
  onCancel: () => void;
}

/**
 * Format a hex SHA-256 fingerprint as colon-separated bytes for display.
 * Same convention OpenSSH and ssh2 use, makes manual cross-checking easy.
 */
function formatFingerprint(hex: string): string {
  const pairs: string[] = [];
  for (let i = 0; i < hex.length; i += 2) {
    pairs.push(hex.slice(i, i + 2));
  }
  return pairs.join(':').toUpperCase();
}

function FingerprintRow({
  label,
  value,
  copied,
  onCopy,
}: {
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="border-b border-edge px-4 py-3">
      <div className="mb-1 flex items-center justify-between gap-3">
        <span className="text-xs text-fg-subtle">{label}</span>
        <button
          type="button"
          onClick={onCopy}
          className="text-xs text-fg-subtle hover:text-fg"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <code className="block break-all font-mono text-[11px] leading-relaxed text-fg">
        {formatFingerprint(value)}
      </code>
    </div>
  );
}

export function HostKeyDialog({ challenge, onTrust, onCancel }: HostKeyDialogProps) {
  const [copiedField, setCopiedField] = useState<string | null>(null);

  useEffect(() => {
    if (!challenge) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', handleEscape);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = '';
    };
  }, [challenge, onCancel]);

  if (!challenge) return null;

  const isUnknown = challenge.code === 'host_key_unknown';

  const copy = async (label: string, value: string) => {
    try {
      await window.electronAPI.clipboard.writeText(value);
      setCopiedField(label);
      setTimeout(() => setCopiedField((cur) => (cur === label ? null : cur)), 1200);
    } catch {
      // clipboard unavailable
    }
  };

  return (
    <div className="no-drag fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" />
      <div className="relative z-10 flex max-h-[92vh] w-full max-w-lg flex-col border border-edge bg-surface-1">
        <div className="border-b border-edge px-4 py-3">
          <h2 className="text-sm font-medium text-fg">
            {isUnknown ? 'Unknown host' : 'Host key changed'}
          </h2>
          <p className="mt-2 text-xs tabular-nums text-fg">{challenge.host}</p>
          <p className="text-xs tabular-nums text-fg-subtle">{challenge.port}</p>
        </div>

        <div className="overflow-y-auto">
          <FingerprintRow
            label="SHA-256"
            value={challenge.fingerprint}
            copied={copiedField === 'new'}
            onCopy={() => { void copy('new', challenge.fingerprint); }}
          />
          {!isUnknown && (
            <FingerprintRow
              label="Previously trusted"
              value={challenge.storedFingerprint}
              copied={copiedField === 'stored'}
              onCopy={() => { void copy('stored', challenge.storedFingerprint); }}
            />
          )}
        </div>

        <div className="flex flex-shrink-0 items-center justify-end gap-2 px-4 py-3">
          <Button variant="ghost" size="sm" onClick={onCancel} autoFocus={!isUnknown}>
            Cancel
          </Button>
          <Button size="sm" onClick={onTrust} autoFocus={isUnknown}>
            {isUnknown ? 'Trust and connect' : 'Replace and connect'}
          </Button>
        </div>
      </div>
    </div>
  );
}
