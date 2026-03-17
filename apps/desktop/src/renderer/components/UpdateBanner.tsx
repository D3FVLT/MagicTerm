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

  useEffect(() => {
    const unsubscribe = window.electronAPI.updater.onStatus((status) => {
      setUpdateStatus(status);
      if (status.status === 'available' || status.status === 'downloaded') {
        setDismissed(false);
      }
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const handleCheckUpdate = async () => {
    setUpdateStatus({ status: 'checking' });
    await window.electronAPI.updater.check();
  };

  const handleDownload = async () => {
    await window.electronAPI.updater.download();
  };

  const handleInstall = () => {
    window.electronAPI.updater.install();
  };

  if (dismissed || !updateStatus) {
    return null;
  }

  if (updateStatus.status === 'not-available' || updateStatus.status === 'checking') {
    return null;
  }

  if (updateStatus.status === 'error') {
    return null;
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
            <span className="text-sm text-gray-200">
              Version {updateStatus.info?.version} is available
            </span>
          )}

          {updateStatus.status === 'downloading' && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-200">
                Downloading update... {updateStatus.progress}%
              </span>
              <div className="h-1.5 w-24 overflow-hidden rounded-full bg-gray-700">
                <div
                  className="h-full bg-primary-500 transition-all"
                  style={{ width: `${updateStatus.progress}%` }}
                />
              </div>
            </div>
          )}

          {updateStatus.status === 'downloaded' && (
            <span className="text-sm text-gray-200">
              Update ready to install (v{updateStatus.info?.version})
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {updateStatus.status === 'available' && (
            <Button size="sm" onClick={handleDownload}>
              Download
            </Button>
          )}

          {updateStatus.status === 'downloaded' && (
            <Button size="sm" onClick={handleInstall}>
              Restart & Install
            </Button>
          )}

          <button
            onClick={() => setDismissed(true)}
            className="rounded p-1 text-gray-400 hover:bg-gray-800 hover:text-white"
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
      className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-400 hover:bg-gray-800 hover:text-white disabled:opacity-50"
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
