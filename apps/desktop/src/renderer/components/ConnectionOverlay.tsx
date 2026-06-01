interface ConnectionOverlayProps {
  status?: 'connecting' | 'error';
  serverName?: string;
  error?: string;
  onRetry?: () => void;
  background?: string;
}

export function ConnectionOverlay({ status, serverName, error, onRetry, background }: ConnectionOverlayProps) {
  if (status !== 'connecting' && status !== 'error') return null;

  return (
    <div
      className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 px-6 text-center"
      style={{ backgroundColor: background || 'var(--bg)' }}
    >
      {status === 'connecting' ? (
        <>
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
          <div className="text-sm text-[var(--fg)]">
            Connecting{serverName ? ` to ${serverName}` : ''}…
          </div>
          <div className="text-xs text-[var(--fg-subtle)]">Waiting for the host to respond</div>
        </>
      ) : (
        <>
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-500/10">
            <svg className="h-6 w-6 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636L5.636 18.364m0-12.728l12.728 12.728" />
            </svg>
          </div>
          <div className="max-w-md">
            <div className="text-sm font-medium text-[var(--fg)]">
              Couldn’t connect{serverName ? ` to ${serverName}` : ''}
            </div>
            <div className="mt-1 text-xs text-[var(--fg-subtle)]">
              {error || 'The host is unreachable or refused the connection.'}
            </div>
          </div>
          {onRetry && (
            <button
              onClick={onRetry}
              className="mt-1 rounded-md bg-[var(--accent)] px-4 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[var(--accent-hover)]"
            >
              Retry
            </button>
          )}
        </>
      )}
    </div>
  );
}
