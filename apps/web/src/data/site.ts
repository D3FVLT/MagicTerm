import pkg from '../../package.json';

export const SITE = {
  name: 'Magic Term',
  shortName: 'MagicTerm',
  version: pkg.version,
  domain: 'magicterm.app',
  url: 'https://magicterm.app',
  tagline: 'Your terminal, magically secure.',
  description:
    'Cross-platform SSH/SFTP client with end-to-end encrypted credentials, cloud sync via Supabase, and a built-in SFTP file manager. macOS, Windows, Linux. Free and open-source.',
  twitter: '',
  githubRepo: 'D3FVLT/MagicTerm',
  githubUrl: 'https://github.com/D3FVLT/MagicTerm',
  releasesUrl: 'https://github.com/D3FVLT/MagicTerm/releases',
  latestReleaseUrl: 'https://github.com/D3FVLT/MagicTerm/releases/latest',
  donateUrl: 'https://www.donationalerts.com/r/whitenobel',
  license: 'MIT',
  author: 'MagicTerm contributors',
} as const;

export const NAV = [
  { label: 'Features', href: '/#features' },
  { label: 'Themes', href: '/#themes' },
  { label: 'Security', href: '/#security' },
  { label: 'Download', href: '/download' },
  { label: 'Changelog', href: '/changelog' },
] as const;
