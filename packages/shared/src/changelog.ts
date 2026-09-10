import data from './changelog.json' with { type: 'json' };

export interface ChangelogItem {
  /** Bold prefix, e.g. "Fixed" or "Snippet variables". */
  label: string;
  /** Markdown-flavoured: `code` and [links](url) only. */
  text: string;
}

export interface ChangelogRelease {
  version: string;
  /** Human month, e.g. "September 2026" — releases aren't precise enough to warrant a day. */
  date: string;
  badge?: 'security';
  items: ChangelogItem[];
}

/** Newest first. */
export const CHANGELOG: ChangelogRelease[] = (data as { releases: ChangelogRelease[] }).releases;

export function findRelease(version: string): ChangelogRelease | undefined {
  const wanted = version.replace(/^v/, '');
  return CHANGELOG.find((release) => release.version === wanted);
}

export type InlineToken =
  | { kind: 'text'; value: string }
  | { kind: 'code'; value: string }
  | { kind: 'link'; value: string; href: string };

const INLINE_PATTERN = /`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)/g;

/**
 * Turns the small Markdown subset used in changelog text into tokens, so both
 * the website and the desktop app can render it without either of them
 * injecting HTML or pulling in a Markdown library.
 */
export function parseInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let cursor = 0;

  for (const match of text.matchAll(INLINE_PATTERN)) {
    const start = match.index ?? 0;
    if (start > cursor) {
      tokens.push({ kind: 'text', value: text.slice(cursor, start) });
    }

    const [full, code, linkText, href] = match;
    if (code !== undefined) {
      tokens.push({ kind: 'code', value: code });
    } else if (linkText !== undefined && href !== undefined) {
      tokens.push({ kind: 'link', value: linkText, href });
    }

    cursor = start + full.length;
  }

  if (cursor < text.length) {
    tokens.push({ kind: 'text', value: text.slice(cursor) });
  }

  return tokens;
}
