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
  const accent = isUnknown ? 'text-amber-400' : 'text-red-400';
  const accentBg = isUnknown ? 'bg-amber-500/10' : 'bg-red-500/10';
  const accentBorder = isUnknown ? 'border-amber-500/30' : 'border-red-500/40';

  const copy = async (label: string, value: string) => {
    try {
      await window.electronAPI.clipboard.writeText(value);
      setCopiedField(label);
      setTimeout(() => setCopiedField((cur) => (cur === label ? null : cur)), 1200);
    } catch {
      // clipboard unavailable — silent
    }
  };

  return (
    <div className="no-drag fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="pointer-events-none absolute inset-0 animate-fade-in bg-black/70 backdrop-blur-sm" />
      <div className="relative z-10 flex max-h-[92vh] w-full max-w-lg animate-scale-in flex-col overflow-hidden rounded-xl bg-surface-1 shadow-2xl">
        <div className={`flex items-start gap-3 border-b ${accentBorder} ${accentBg} px-6 py-4`}>
          <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${accentBg} ${accent}`}>
            {isUnknown ? (
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 15v2m0-12a3 3 0 013 3c0 1.5-1 2-2 2.5S12 12 12 13" />
                <circle cx="12" cy="12" r="9" strokeWidth={2} />
              </svg>
            ) : (
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              </svg>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className={`text-base font-semibold ${accent}`}>
              {isUnknown ? 'Verify host fingerprint' : 'Host key changed — possible MITM'}
            </h2>
            <p className="mt-0.5 text-sm text-fg-muted">
              {challenge.host}:{challenge.port}
            </p>
          </div>
        </div>

        <div className="space-y-4 overflow-y-auto px-6 py-5 text-sm leading-relaxed text-fg">
          {isUnknown ? (
            <p className="text-fg-muted">
              This is the first time MagicTerm is connecting to{' '}
              <span className="font-medium text-fg">{challenge.host}</span>. The server presented
              the SHA-256 fingerprint below. Verify it matches what you expect (e.g. via your
              hosting provider, an existing terminal, or <code className="rounded bg-surface-3 px-1.5 py-0.5 text-xs">ssh-keygen -lf /etc/ssh/ssh_host_*_key.pub</code>).
            </p>
          ) : (
            <p className="text-fg-muted">
              The fingerprint for{' '}
              <span className="font-medium text-fg">{challenge.host}</span> has{' '}
              <span className="font-medium text-red-400">changed</span> since the last connection.
              This can happen after a legitimate server reinstall — but it can also be a
              man-in-the-middle attack. Do not continue unless you are sure the change is expected.
            </p>
          )}

          <div className="space-y-3">
            <FingerprintRow
              label={isUnknown ? 'SHA-256 fingerprint' : 'New fingerprint'}
              value={challenge.fingerprint}
              copied={copiedField === 'new'}
              onCopy={() => copy('new', challenge.fingerprint)}
              tone={isUnknown ? 'neutral' : 'danger'}
            />
            {!isUnknown && (
              <FingerprintRow
                label="Previously trusted"
                value={challenge.storedFingerprint}
                copied={copiedField === 'stored'}
                onCopy={() => copy('stored', challenge.storedFingerprint)}
                tone="neutral"
              />
            )}
          </div>

          {!isUnknown && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3 text-xs text-red-300/90">
              If you trust this new key, the previous one will be replaced. If you weren't
              expecting a server change, cancel and contact whoever runs this host before
              connecting again.
            </div>
          )}
        </div>

        <div className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-edge bg-surface-2/40 px-6 py-3">
          <Button variant="ghost" onClick={onCancel} autoFocus={!isUnknown}>
            Cancel
          </Button>
          <Button
            variant={isUnknown ? 'primary' : 'danger'}
            onClick={onTrust}
            autoFocus={isUnknown}
          >
            {isUnknown ? 'Trust & connect' : 'Replace & connect'}
          </Button>
        </div>
      </div>
    </div>
  );

  function FingerprintRow({
    label,
    value,
    copied,
    onCopy,
    tone,
  }: {
    label: string;
    value: string;
    copied: boolean;
    onCopy: () => void;
    tone: 'neutral' | 'danger';
  }) {
    return (
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-fg-subtle">
            {label}
          </span>
          <button
            onClick={onCopy}
            className="text-xs text-fg-muted transition-colors hover:text-fg"
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <code
          className={`block break-all rounded-md border px-3 py-2 font-mono text-[11.5px] leading-relaxed ${
            tone === 'danger'
              ? 'border-red-500/30 bg-red-500/5 text-red-200'
              : 'border-edge bg-surface-2 text-fg'
          }`}
        >
          {formatFingerprint(value)}
        </code>
      </div>
    );
  }
}
