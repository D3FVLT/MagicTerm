# Magic Term

A free SSH/SFTP client with end-to-end encrypted cloud sync. Cross-platform
desktop app for macOS, Windows and Linux.

[![version](https://img.shields.io/github/v/release/D3FVLT/MagicTerm?color=blue&label=version)](https://github.com/D3FVLT/MagicTerm/releases)
[![license](https://img.shields.io/badge/license-MIT-green)](./LICENSE)

[magicterm.app](https://magicterm.app) ·
[Changelog](https://magicterm.app/changelog) ·
[Roadmap](./ROADMAP.md) ·
[Telegram](https://t.me/magicterm) ·
[Instagram](https://instagram.com/magic.term) ·
[Donate](https://www.donationalerts.com/r/whitenobel)

---

I built this because I was tired of paying Termius for cloud sync. Magic
Term keeps your servers, snippets and credentials encrypted on your device
with a master password you never send anywhere, and only the encrypted
blobs are synced through Supabase. The server cannot read them, even if
the database is dumped.

The desktop app is a regular Electron app (xterm.js + ssh2 + react). The
terminal does what you'd expect: 256-color, splits, search, SFTP file
manager with drag-and-drop, SSH config import, and an HTTP or SOCKS5
proxy if your network needs one. Servers can be grouped into folders and
pinned. Snippets are encrypted commands you paste with one click, and
they can ask for values first — write `{{app}}` in the command and you
get a prompt before it runs. There are three light/dark UI themes and 13
terminal palettes. Multi-user organizations are supported if you want to
share servers with a team.

Screenshots and a feature tour live on [magicterm.app](https://magicterm.app).

## Install

Grab the latest build from the [releases page](https://github.com/D3FVLT/MagicTerm/releases/latest):

- **macOS** — `.dmg` for your architecture (`arm64` for M1+, `x64` for Intel).
  The app isn't notarized yet, so on first launch run
  `xattr -cr "/Applications/Magic Term.app"` once. Auto-updates show a
  notification with a download link.
- **Windows** — `MagicTerm-x64.exe`. The app tells you when an update is
  out, downloads it once you accept, and installs it silently on restart.
- **Linux** — `.AppImage`, `.deb`, or `yay -S magicterm-bin` from the AUR.
  Updates are manual for now: download the new build from the releases
  page, or run `yay -Syu` if you installed from the AUR.

## Run from source

You need Node 20+ and pnpm 10 (the repo pins it via `packageManager`, so
`corepack enable` is enough).

```bash
git clone https://github.com/D3FVLT/MagicTerm.git
cd MagicTerm
pnpm install
cp apps/desktop/.env.example apps/desktop/.env  # add your Supabase keys
pnpm dev
```

The SQL for the backend lives in [`supabase/`](./supabase/), and
[`supabase/README.md`](./supabase/README.md) lists the order to apply it
in. For desktop builds:

```bash
pnpm --filter @magicterm/desktop dist:mac    # or dist:win / dist:linux
```

Releases are tagged (`git tag v0.x.x && git push origin v0.x.x`) and built
in parallel by GitHub Actions. The workflow needs `SUPABASE_URL` and
`SUPABASE_ANON_KEY` in repo secrets.

## How the encryption works

Master password goes through scrypt to derive a 256-bit key. That key
encrypts every credential, snippet and SSH key with AES-256-GCM before
anything leaves the device. Supabase only ever sees ciphertext, even if
its database leaks. The master password itself is never sent or stored
on the server — only a verifier hash that proves you know it without
revealing it.

The renderer process runs sandboxed with `contextIsolation: true` and a
strict CSP. SSH and SFTP go through ssh2 in the main process with
trust-on-first-use host-key pinning (you confirm the SHA-256 fingerprint
on first connect, and a mismatch later triggers a loud MITM warning).
Server-side, RLS policies make sure one user can't read another user's
encrypted blobs even if they tried.

If you spot something fishy in the crypto or the IPC surface, open an
issue. The whole code is open and I'd rather know.

## Status

The app is in active development and works for daily use, but it's still
pre-1.0 — schema and APIs may change between minor versions. See
[ROADMAP.md](./ROADMAP.md) for what's coming and what's already shipped.

Feedback, bug reports and PRs are very welcome — open an issue on GitHub.

## Follow along

Release notes and write-ups about how things work go out on Telegram;
screenshots and short clips on Instagram.

- Telegram — [@magicterm](https://t.me/magicterm)
- Instagram — [@magic.term](https://instagram.com/magic.term)

Every release is also on
[magicterm.app/changelog](https://magicterm.app/changelog) and in the app
itself, under the account menu → What's new.

## Support the project

Right now everything is on me: servers, Supabase, the domain, the time.
The app is and will stay free, but if it saved you a Termius subscription
and you can spare a coffee, there's a donate link below. Every contribution
goes back into the project — covering hosting, paying for code-signing
certificates (so you can stop running `xattr -cr` on macOS), and freeing
up time to ship roadmap items faster.

Donate: [donationalerts.com/r/whitenobel](https://www.donationalerts.com/r/whitenobel)

Thank you!

## License

MIT — see [LICENSE](./LICENSE).
