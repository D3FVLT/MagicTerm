import { Modal } from './ui/Modal';
import { CHANGELOG, parseInline } from '@magicterm/shared';
import { GITHUB_URL } from '../lib/links';

declare const __APP_VERSION__: string;

/**
 * The changelog that ships with the app. Same source as the website, so the
 * notes here are the ones written by hand rather than a list of commit
 * subjects. For a version you haven't installed yet see `UpdateBanner`, which
 * has to take what the GitHub release gives it.
 */

function InlineText({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((token, index) => {
        if (token.kind === 'code') {
          return (
            <code
              key={index}
              className="rounded border border-[var(--border)] bg-[var(--surface-2)] px-1 py-0.5 font-mono text-[0.85em] text-[var(--fg)]"
            >
              {token.value}
            </code>
          );
        }
        if (token.kind === 'link') {
          return (
            <a
              key={index}
              href={token.href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--accent)] hover:underline"
            >
              {token.value}
            </a>
          );
        }
        return <span key={index}>{token.value}</span>;
      })}
    </>
  );
}

interface ChangelogModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ChangelogModal({ isOpen, onClose }: ChangelogModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="What's new" size="lg">
      <div className="space-y-8">
        {CHANGELOG.map((release) => (
          <section key={release.version}>
            <header className="mb-3 flex flex-wrap items-baseline gap-2.5">
              <h3 className="text-base font-semibold text-[var(--fg)]">v{release.version}</h3>
              <span className="text-xs text-[var(--fg-subtle)]">{release.date}</span>
              {release.version === __APP_VERSION__ && (
                <span className="rounded-full bg-[var(--accent)]/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--accent)]">
                  Installed
                </span>
              )}
              {release.badge === 'security' && (
                <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-400">
                  Security
                </span>
              )}
            </header>

            <ul className="space-y-2">
              {release.items.map((item, index) => (
                <li
                  key={index}
                  className="relative pl-4 text-sm leading-relaxed text-[var(--fg-muted)] before:absolute before:left-0 before:font-bold before:text-[var(--accent)] before:content-['·']"
                >
                  <strong className="font-medium text-[var(--fg)]">{item.label}:</strong>{' '}
                  <InlineText text={item.text} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <div className="mt-8 border-t border-[var(--border)] pt-4 text-center">
        <a
          href={`${GITHUB_URL}/releases`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-[var(--accent)] hover:underline"
        >
          Full release history on GitHub →
        </a>
      </div>
    </Modal>
  );
}
