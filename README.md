# Magic Term

Cross-platform SSH/SFTP client with E2E encryption and cloud sync.

## Features

- SSH terminal with full color support
- SFTP/FTP file transfer support
- Organizations with team invites
- Secure credential storage with E2E encryption
- Cloud sync via Supabase
- Cross-platform (macOS, Windows)
- Auto-update support

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 9+

### Setup

1. Clone the repository:

```bash
git clone https://github.com/D3FVLT/MagicTerm.git
cd MagicTerm
```

2. Install dependencies:

```bash
pnpm install
```

3. Set up Supabase:
   - Create a project at [supabase.com](https://supabase.com)
   - Run the SQL schema from `supabase/schema.sql` in the SQL Editor
   - Enable Email auth in Authentication settings

4. Configure environment:

```bash
cp apps/desktop/.env.example apps/desktop/.env
# Edit .env with your Supabase credentials
```

5. Start development:

```bash
pnpm dev
```

## Installation

### macOS

Download the `.dmg` file from [Releases](../../releases).

**Important:** Since the app is not code-signed, macOS may show "Magic Term is damaged". To fix this:

```bash
# Remove quarantine attribute
xattr -cr "/Applications/Magic Term.app"
```

Or right-click the app → Open → Open (first time only).

### Windows

Download the `.exe` installer from [Releases](../../releases) and run it.

## Project Structure

```
MagicTerm/
├── apps/
│   └── desktop/          # Electron app
│       ├── src/
│       │   ├── main/     # Electron main process
│       │   ├── preload/  # Preload scripts
│       │   └── renderer/ # React UI
│       └── ...
├── packages/
│   ├── shared/           # Shared types & constants
│   ├── crypto/           # E2E encryption
│   └── supabase-client/  # Supabase SDK wrapper
└── ...
```

## Security

- All credentials are encrypted client-side with AES-256-GCM
- Master password is never transmitted or stored
- Only encrypted data is synced to Supabase
- Row Level Security ensures users can only access their own data

## Building

Build for your platform:

```bash
# macOS
pnpm --filter @magicterm/desktop dist:mac

# Windows
pnpm --filter @magicterm/desktop dist:win
```

## GitHub Actions Setup

To enable automated releases, add these secrets in your repository settings:

| Secret Name | Description |
|-------------|-------------|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_ANON_KEY` | Your Supabase publishable key |

Then create a tag to trigger a release:

```bash
git tag v0.1.0
git push origin v0.1.0
```

## License

MIT
