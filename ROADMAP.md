# Roadmap

A living document. Things move around as priorities shift.
The further down a section, the further out the work is.

Legend: ✅ done · 🛠 in progress · ⏳ planned · 💭 idea / not committed

---

## v0.6 — Trust & Polish (next minor)

The story for v0.6 is "make the security claims iron-clad and tighten the
desktop UX". After v0.5 shipped a deep audit, the gaps that remain are mostly
about **supply-chain trust**, not the runtime security model.

- ⏳ **Code-sign macOS builds** — Apple Developer ID + notarization.
  - Eliminates the `xattr -cr` ritual on first launch.
  - Hardens the auto-updater: signed binary + blockmap, not just blockmap.
  - Removes the biggest "honest disclosure" item on the website's Security section.
- ⏳ **Code-sign Windows builds** — EV cert or Azure Trusted Signing.
  - Removes SmartScreen warning for new releases.
  - Lower priority than macOS (Windows users tolerate the warning better).
- ✅ **Repository checksums on the website's `/download`** — SHA256 of each
  installer on the download page; `SHA256SUMS.txt` attached to every GitHub release.
- ⏳ **Move credential decryption into the main process** — keep the master key
  off the renderer entirely. Renderer holds only ciphertext until the moment of
  use. Reduces the blast radius of a hypothetical XSS to near zero.
- ⏳ **SSH key passphrase support in the UI** — currently we only handle
  passphrase-less keys cleanly. Prompt for passphrase per-connection or per-session.
- ⏳ **Auto-update on Linux** — currently manual download only. Investigate
  AppImageUpdate / `electron-updater` Linux flow.
- ⏳ **Local-only mode (no account)** — let users run Magic Term without ever
  signing in to Supabase. Vault stays local, encrypted with the master password.
  Removes the only piece of friction from "free, open source, no strings".
  Sync becomes opt-in instead of mandatory.

## v0.7 — Desktop QoL & Power Features

- ⏳ **SSH config import** — read `~/.ssh/config` and offer to import hosts as
  read-only entries (no creds, just hostnames + ports).
- ⏳ **Port forwarding UI** — local/remote/dynamic forwards with one-click toggles
  and per-server presets.
- ⏳ **Tabbed terminal panes** — Cmd+T / Ctrl+T for new tab inside a vault session.
- ⏳ **Command palette (Cmd+K)** — fuzzy search across servers, snippets, settings,
  and recent commands.
- ⏳ **Per-server environment** — environment variables and starting working
  directory you can configure per-server.
- ⏳ **Session record / replay** — opt-in local-only recording of a session for
  debugging. Stored encrypted, never synced.

## v0.8 — Collaboration & Sharing

- 💭 **Vault sharing** — invite a teammate to a shared organisation vault. Already
  scaffolded server-side; needs UX and permission model.
- 💭 **Audit log** — see who connected to what, when, from which workspace.
- 💭 **Snippet sharing** — make a snippet available to your org while keeping
  encryption (re-encrypt to org public key).

## v1.0 — Stability commitment

- ⏳ Locked schema for credentials and snippets (migrations only forward-compatible).
- ⏳ Long-term support window for v1.x (security fixes for ≥12 months).
- ⏳ Public threat model document.
- ⏳ External security review (paid third-party audit if there's funding).

---

## Far-future / wish-list

- 💭 **Agent forwarding** with explicit per-host opt-in.
- 💭 **Mosh** support (UDP-based resilient SSH).
- 💭 **WebAuthn / passkey** as a second factor for unlocking the app.
- 💭 **Mobile companion** — read-only viewer of vaults on iOS/Android.

## Recently shipped

- ✅ **v0.5.5** — supply-chain trust + connection UX: SHA256 checksums on `/download` and in every GitHub release (`SHA256SUMS.txt`), clearer SSH/SFTP connect states (spinner, friendly errors, Retry), 15 s timeout for unreachable hosts, no more stray handshake errors after closing a tab mid-connect, Electron 42 + dependency security updates, Dependabot for automated patch PRs.
- ✅ **v0.5.4** — terminal hardening: explicit TOFU host-key prompts (no more silent trust on first connect), keyboard shortcuts cheatsheet modal, fixes for long-command rendering and `nano` redraws on retina macOS, Ctrl+R/Ctrl+L/Ctrl+C and other readline shortcuts now work on non-Latin keyboard layouts (Cyrillic, German, Greek, …).
- ✅ **v0.5.3** — auth-flow polish: registration confirmation banner, password reset, account deletion with org ownership transfer, donate link, branded email templates, recovery from stale/deleted-account sessions.
- ✅ **v0.5.2** — theme persistence fix.
- ✅ **v0.5.1** — three app themes (Midnight / Onyx / Daylight) with paired terminal palettes; clipboard + proxy fixes after the security audit.
- ✅ **v0.5.0** — full security audit: scrypt KDF, master-password verifier, server-side RLS hardening, sandboxed renderer, TOFU host verification, auto-clear clipboard.
