# Magic Term

Cross-platform SSH/SFTP client with E2E encryption and cloud sync.

![Magic Term](https://img.shields.io/badge/version-0.3.9-blue) ![License](https://img.shields.io/badge/license-MIT-green)

## Features

- **SSH Terminal** — full color support, search (Cmd/Ctrl+F)
- **SFTP File Manager** — dual-panel UI, drag-and-drop transfers
- **Built-in Text Editor** — edit remote files directly
- **Session Tabs** — multiple connections with persistent state
- **Personal Snippets** — encrypted storage for tokens/secrets, paste to terminal
- **Organizations** — team collaboration with role management (owner/admin/member/viewer)
- **E2E Encryption** — credentials encrypted client-side with AES-256-GCM
- **Cloud Sync** — via Supabase, works across devices
- **Cross-platform** — macOS, Windows, Linux
- **Auto-updates** — Windows (silent), macOS (notification with download link)

## Installation

### Windows

Download [MagicTerm-x64.exe](../../releases/latest) and run the installer.

Auto-updates are enabled — the app will silently update in background.

### macOS

Download the `.dmg` for your architecture:
- **Apple Silicon (M1/M2/M3):** [MagicTerm-arm64.dmg](../../releases/latest)
- **Intel:** [MagicTerm-x64.dmg](../../releases/latest)

**First launch fix** (app is not code-signed):

```bash
xattr -cr "/Applications/Magic Term.app"
```

Auto-updates show a notification with download link.

### Linux

**AppImage:**

```bash
chmod +x MagicTerm-*-x64.AppImage
./MagicTerm-*-x64.AppImage
```

**Debian/Ubuntu:**

```bash
sudo dpkg -i magicterm_*_amd64.deb
```

**Arch Linux (AUR):**

```bash
yay -S magicterm-bin
```

> Auto-updates are not supported on Linux.

## Quick Start (Development)

### Prerequisites

- Node.js 20+
- pnpm 9+

### Setup

```bash
# Clone
git clone https://github.com/D3FVLT/MagicTerm.git
cd MagicTerm

# Install dependencies
pnpm install

# Set up Supabase (see docs/SUPABASE_SETUP.md)
cp apps/desktop/.env.example apps/desktop/.env
# Edit .env with your Supabase credentials

# Run the SQL schema
# Execute supabase/schema.sql in your Supabase SQL Editor
# Then run additional migrations: add-user-profiles.sql, add-user-settings.sql, add-snippets.sql

# Start development
pnpm dev
```

## Project Structure

```
MagicTerm/
├── apps/
│   └── desktop/           # Electron app
│       ├── src/
│       │   ├── main/      # Main process (SSH, SFTP, updater)
│       │   ├── preload/   # IPC bridge
│       │   └── renderer/  # React UI
│       └── ...
├── packages/
│   ├── shared/            # Shared types & constants
│   ├── crypto/            # E2E encryption (AES-256-GCM)
│   └── supabase-client/   # Supabase SDK wrapper
└── supabase/              # Database schema & migrations
```

## Security

- **Client-side encryption** — All credentials encrypted with AES-256-GCM before leaving your device
- **Master password** — Never transmitted or stored, only used to derive encryption keys
- **Zero-knowledge sync** — Supabase only stores encrypted blobs
- **Row Level Security** — Database policies ensure data isolation between users

## Building

```bash
# macOS (Intel + Apple Silicon)
pnpm --filter @magicterm/desktop dist:mac

# Windows (x64)
pnpm --filter @magicterm/desktop dist:win

# Linux (AppImage + deb)
pnpm --filter @magicterm/desktop dist:linux
```

Output will be in `apps/desktop/release/`.

## CI/CD Setup

Add these secrets to your GitHub repository:

| Secret | Description |
|--------|-------------|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_ANON_KEY` | Supabase publishable (anon) key |

Create a tag to trigger a release:

```bash
git tag v0.4.0
git push origin v0.4.0
```

The workflow builds all platforms in parallel, then creates a release with all artifacts.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

MIT
