import { useState, useEffect } from 'react';
import { ProxySettingsModal } from './ProxySettingsModal';

/** How long a normal start takes before we assume something is wrong. */
const HINT_DELAY_MS = 5000;

interface StartupScreenProps {
  variant: 'loading' | 'unreachable';
  onRetry: () => void;
}

/**
 * The first thing the app shows, and — when the proxy is misconfigured — the
 * only thing it can show, since every Supabase call is routed through it. So
 * the proxy settings have to live here too, not just behind the login form.
 */
export function StartupScreen({ variant, onRetry }: StartupScreenProps) {
  const unreachable = variant === 'unreachable';
  const [showProxy, setShowProxy] = useState(false);
  const [hintVisible, setHintVisible] = useState(unreachable);

  useEffect(() => {
    if (unreachable) {
      setHintVisible(true);
      return;
    }
    setHintVisible(false);
    const timer = setTimeout(() => setHintVisible(true), HINT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [unreachable]);

  return (
    <div className="flex h-screen items-center justify-center bg-app">
      <div className="flex max-w-sm flex-col items-center gap-4 px-6 text-center">
        {unreachable ? (
          <svg className="h-8 w-8 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01M5.07 19h13.86a2 2 0 001.74-3L13.74 4a2 2 0 00-3.48 0L3.33 16a2 2 0 001.74 3z"
            />
          </svg>
        ) : (
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        )}

        <span className="text-fg-muted">
          {unreachable ? "Couldn't reach the server" : 'Loading...'}
        </span>

        {hintVisible && (
          <>
            <p className="text-sm text-fg-subtle">
              {unreachable
                ? 'Sign-in and sync go through your proxy. If it is down or misconfigured, nothing gets through.'
                : 'Taking longer than usual. If you are behind a proxy, it may be unreachable.'}
            </p>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowProxy(true)}
                className="rounded-lg border border-edge bg-surface-2 px-3 py-1.5 text-sm font-medium text-fg transition-colors hover:border-accent hover:text-accent"
              >
                Proxy settings
              </button>
              <button
                type="button"
                onClick={onRetry}
                className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover"
              >
                Retry
              </button>
            </div>
          </>
        )}
      </div>

      <ProxySettingsModal
        isOpen={showProxy}
        onClose={() => setShowProxy(false)}
        onSaved={onRetry}
      />
    </div>
  );
}
