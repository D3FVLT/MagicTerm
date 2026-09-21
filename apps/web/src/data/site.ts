import pkg from '../../package.json';

export const SITE = {
  name: 'Magic Term',
  shortName: 'MagicTerm',
  version: pkg.version,
  domain: 'magicterm.app',
  url: 'https://magicterm.app',
  tagline: 'SSH and SFTP client.',
  description:
    'Free SSH and SFTP client for macOS, Windows, and Linux. Secrets are encrypted on the device. Local mode needs no account. Builds are unsigned; SHA256 is on the download page.',
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
  { label: 'Security', href: '/#security' },
  { label: 'Download', href: '/download' },
  { label: 'Changelog', href: '/changelog' },
] as const;
