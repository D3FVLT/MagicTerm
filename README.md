# MagicTerm

Cross-platform SSH/SFTP client with E2E encryption and cloud sync.

## Features

- SSH terminal with full color support
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
git clone https://github.com/your-username/magicterm.git
cd magicterm
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

## Project Structure

```
magicterm/
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

## Releases

Releases are automated via GitHub Actions. To create a release:

```bash
git tag v0.1.0
git push origin v0.1.0
```

## License

MIT
