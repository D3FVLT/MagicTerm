import { useState, useEffect } from 'react';
import { Button } from './ui/Button';

interface UpdateInfo {
  version: string;
  releaseDate: string;
  releaseNotes?: string;
}

interface UpdateStatus {
  status: 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
  info?: UpdateInfo;
  progress?: number;
  error?: string;
}

export function UpdateBanner() {
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [isMac, setIsMac] = useState(false);
  const [showChangelog, setShowChangelog] = useState(false);
  const [shownVersion, setShownVersion] = useState<string | null>(null);

  useEffect(() => {
    window.electronAPI.updater.getPlatform().then((info) => {
      setIsMac(info.isMac);
    });

    const unsubscribe = window.electronAPI.updater.onStatus((status) => {
      setUpdateStatus(status);
      if (status.status === 'available' || status.status === 'downloaded') {
        setDismissed(false);
        // Auto-open changelog once per new version.
        if (status.info?.version && status.info.version !== shownVersion) {
          setShowChangelog(true);
          setShownVersion(status.info.version);
        }
      }
    });

    return () => {
      unsubscribe();
    };
  }, [shownVersion]);

  const handleDownload = async () => {
    if (isMac) {
      // On macOS, just open release page
      await window.electronAPI.updater.openReleasePage();
      setDismissed(true);
    } else {
      await window.electronAPI.updater.download();
    }
  };

  const handleInstall = () => {
    if (isMac) {
      window.electronAPI.updater.openReleasePage();
      return;
    }
    setIsInstalling(true);
    window.electronAPI.updater.install();
  };

  if (dismissed || !updateStatus) {
    return null;
  }

  if (updateStatus.status === 'not-available' || updateStatus.status === 'checking') {
    return null;
  }

  if (updateStatus.status === 'error') {
    return (
      <div className="border-b border-red-500/30 bg-red-500/10 px-4 py-2">
        <div className="flex items-center justify-between">
          <span className="text-sm text-red-200">
            Update failed: {updateStatus.error}
          </span>
          <button
            onClick={() => setDismissed(true)}
            className="rounded p-1 text-fg-muted hover:bg-surface-2 hover:text-fg"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="border-b border-primary-500/30 bg-primary-500/10 px-4 py-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <svg
            className="h-5 w-5 text-primary-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
            />
          </svg>

          {updateStatus.status === 'available' && (
            <span className="text-sm text-fg">
              Version {updateStatus.info?.version} is available
              {isMac && ' (manual download required)'}
            </span>
          )}

          {updateStatus.status === 'downloading' && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-fg">
                Downloading update... {updateStatus.progress}%
              </span>
              <div className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-3">
                <div
                  className="h-full bg-primary-500 transition-all"
                  style={{ width: `${updateStatus.progress}%` }}
                />
              </div>
            </div>
          )}

          {updateStatus.status === 'downloaded' && (
            <span className="text-sm text-fg">
              Update ready to install (v{updateStatus.info?.version})
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {updateStatus.status === 'available' && (
            <Button size="sm" onClick={handleDownload}>
              {isMac ? 'Download from GitHub' : 'Download'}
            </Button>
          )}

          {(updateStatus.status === 'available' || updateStatus.status === 'downloaded') && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowChangelog(true)}
            >
              View Changelog
            </Button>
          )}

          {updateStatus.status === 'downloaded' && (
            <Button size="sm" onClick={handleInstall} disabled={isInstalling}>
              {isInstalling ? 'Restarting...' : 'Restart & Install'}
            </Button>
          )}

          <button
            onClick={() => setDismissed(true)}
            className="rounded p-1 text-fg-muted hover:bg-surface-2 hover:text-fg"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
      </div>

      {showChangelog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-xl border border-[var(--border)] bg-[var(--surface-1)] shadow-2xl">
            <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
              <h3 className="text-sm font-semibold text-[var(--fg)]">
                What&apos;s New in v{updateStatus.info?.version || 'next update'}
              </h3>
              <button
                onClick={() => setShowChangelog(false)}
                className="rounded p-1 text-[var(--fg-subtle)] hover:bg-[var(--border)] hover:text-[var(--fg)]"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="overflow-y-auto px-4 py-3">
              {updateStatus.info?.releaseNotes?.trim() ? (
                <div
                  className="release-notes prose-sm text-sm leading-relaxed text-[var(--fg)]"
                  dangerouslySetInnerHTML={{ __html: updateStatus.info.releaseNotes.trim() }}
                />
              ) : (
                <p className="text-sm text-[var(--fg-subtle)]">Changelog is not available for this release.</p>
              )}
            </div>
            <div className="flex justify-end border-t border-[var(--border)] px-4 py-3">
              <Button size="sm" onClick={() => setShowChangelog(false)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function UpdateButton() {
  const [isChecking, setIsChecking] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = window.electronAPI.updater.onStatus((updateStatus) => {
      if (updateStatus.status === 'available' && updateStatus.info) {
        setStatus(`v${updateStatus.info.version} available`);
      } else if (updateStatus.status === 'not-available') {
        setStatus('Up to date');
        setTimeout(() => setStatus(null), 3000);
      } else if (updateStatus.status === 'error') {
        setStatus('Check failed');
        setTimeout(() => setStatus(null), 3000);
      }
      setIsChecking(false);
    });
    return () => unsubscribe();
  }, []);

  const handleCheck = async () => {
    setIsChecking(true);
    setStatus('Checking...');
    await window.electronAPI.updater.check();
  };

  return (
    <button
      onClick={handleCheck}
      disabled={isChecking}
      className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-fg-muted hover:bg-surface-2 hover:text-fg disabled:opacity-50"
    >
      <svg
        className={`h-4 w-4 ${isChecking ? 'animate-spin' : ''}`}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
        />
      </svg>
      {status || 'Check for updates'}
    </button>
  );
}
