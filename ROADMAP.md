# Roadmap

A living document. Things move around as priorities shift.
The further down a section, the further out the work is.

Legend: ✅ done · 🛠 in progress · ⏳ planned · 💭 idea / not committed ·
❌ decided against (reason given)

---

## v0.6 — Trust & Polish (next minor)

The story for v0.6 is "make the security claims iron-clad and tighten the
desktop UX". After v0.5 shipped a deep audit, the gaps that remain are mostly
about **supply-chain trust**, not the runtime security model.

- ⏳ **Code-sign macOS builds** — Apple Developer ID + notarization.
  - Eliminates the `xattr -cr` ritual on first launch.
  - Hardens the auto-updater: signed binary + blockmap, not just blockmap.
  - Removes the biggest "honest disclosure" item on the website's Security section.
  - Until then: unsigned builds, with `SHA256SUMS.txt` on every release and the
    checksums published on `/download`.
- ⏳ **Code-sign Windows builds** — EV cert or Azure Trusted Signing.
  - Removes SmartScreen warning for new releases.
  - Lower priority than macOS (Windows users tolerate the warning better).
- ✅ **Repository checksums on the website's `/download`** — SHA256 of each
  installer on the download page; `SHA256SUMS.txt` attached to every GitHub release.
- ⏳ **SSH key passphrase support in the UI** — currently we only handle
  passphrase-less keys cleanly. Prompt for passphrase per-connection or per-session.
  Encrypted keys are the norm, so today some people simply can't connect.
- ✅ **Proxy settings reachable from the startup screen** — a dead proxy used to
  hang the app on an infinite spinner, and the existing proxy UI sat behind the
  login form the proxy was preventing you from reaching. Auth startup is now
  bounded at 15 s and the loading screen offers proxy settings and a retry.
- ⏳ **Local-only mode (no account)** — let users run Magic Term without ever
  signing in to Supabase. Vault stays local, encrypted with the master password.
  Removes the only piece of friction from "free, open source, no strings".
  Sync becomes opt-in instead of mandatory.
- ❌ **Move credential decryption into the main process** — the threat it defends
  against is XSS in the renderer, and the renderer is already sandboxed, runs with
  `contextIsolation`, and loads no remote content. So the realistic gain is close
  to zero while the cost is rewriting `@magicterm/crypto` and every context that
  touches it. Revisit only if the renderer ever renders untrusted HTML.
- ❌ **Auto-update on Linux** — the AppImage update flow is fragile and the Linux
  share of downloads doesn't justify maintaining a third update path. Manual
  download stays, and distro packaging would be a better answer if demand shows up.

## v0.7 — Desktop QoL & Power Features

- ⏳ **AI assistant, bring-your-own-key** — the big one for this minor. You paste
  your own provider key (OpenAI / Anthropic / OpenRouter, or point it at a local
  Ollama endpoint) and get an assistant that works inside the terminal: describe
  what you want and get a command back, explain a command before you run it,
  explain an error, summarise a wall of log output.
  - The key is a credential like any other: stored in the existing vault,
    encrypted client-side, never in plaintext on disk.
  - **Never auto-executes.** Suggestions land on the prompt line for you to read
    and press Enter yourself — the same rule snippet paste follows.
  - The hard part isn't calling a model, it's deciding what leaves the machine.
    Terminal output from a production host is full of hostnames, tokens and
    paths. So: off by default, opt-in per server, and the exact payload is shown
    before the first send. Nothing is sent implicitly in the background.
  - A local Ollama endpoint is the zero-egress option and should be a
    first-class choice, not an afterthought.
  - Ships together with an update to the website's privacy wording — "your data
    never leaves your machine" needs a precise carve-out once this exists.
- ✅ **SSH config import** — read `~/.ssh/config` and offer to import hosts as
  read-only entries (no creds, just hostnames + ports).
- ✅ **Snippet variables** — `{{name}}` / `{{name=default}}` placeholders inside a
  snippet. Using it prompts for the values, shows a live preview, then pastes the
  result. Repeated names are asked once, so
  `pm2 restart {{id}} && pm2 logs {{id}}` needs a single answer.
- ✅ **Custom snippet order** — drag snippets in the panel to arrange them; the
  1–9 shortcuts follow that order instead of the alphabet, so adding a snippet
  no longer reshuffles anyone's muscle memory.
- ⏳ **Port forwarding UI** — local/remote/dynamic forwards with one-click toggles
  and per-server presets.
- ⏳ **Command palette (Cmd+K)** — fuzzy search across servers, snippets, settings,
  and recent commands.
- ⏳ **Per-server environment** — environment variables and starting working
  directory you can configure per-server.
- ⏳ **Session record / replay** — opt-in local-only recording of a session for
  debugging. Stored encrypted, never synced.
- ❌ **Tabbed terminal panes** — stale entry. Session tabs and split panes both
  already exist; a third nesting level inside a tab would add UI weight without
  giving anyone a layout they can't already build.

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

- ✅ **v0.5.9** — snippet variables: `{{name}}` placeholders prompt for values before a snippet runs, with per-session recall and Docker/Go template strings left untouched; drag-to-reorder snippets driving the 1–9 paste shortcuts; proxy settings and retry on the startup screen after a bounded auth timeout; tooltips rendered by the app so icon-only buttons finally show them, plus accessible names on every icon button; a dismissible support card with a toggle in Settings; and one curated changelog feeding the website, the GitHub release body and a new in-app "What's new" modal.
- ✅ **v0.5.8** — server folders for personal and org vaults ([#19](https://github.com/D3FVLT/MagicTerm/issues/19)): collapsible sections, drag-and-drop between folders, rename/delete without losing servers, pins scoped to their folder, and DB triggers enforcing folder/vault scope on top of RLS.
- ✅ **v0.5.7** — vault switch keeps open-tab server names (no more "Unknown"); snippets keyboard workflow (Cmd/Ctrl+Shift+S, 1–9 paste, Esc) with discoverability in the shortcuts modal and panel UI.
- ✅ **v0.5.6** — terminal reliability on macOS (PTY/xterm sync, history ↑, nano, docker compose output), Ctrl+R via physical key mapping, SSH connecting overlay, server modal UX ([#18](https://github.com/D3FVLT/MagicTerm/issues/18)); **hotfix rebuild** fixes Ctrl+R in production (electron-toolkit was blocking it outside dev).
- ✅ **v0.5.5** — supply-chain trust + connection UX: SHA256 checksums on `/download` and in every GitHub release (`SHA256SUMS.txt`), clearer SSH/SFTP connect states (spinner, friendly errors, Retry), 15 s timeout for unreachable hosts, no more stray handshake errors after closing a tab mid-connect, Electron 42 + dependency security updates, Dependabot for automated patch PRs.
- ✅ **v0.5.4** — terminal hardening: explicit TOFU host-key prompts (no more silent trust on first connect), keyboard shortcuts cheatsheet modal, fixes for long-command rendering and `nano` redraws on retina macOS, Ctrl+R/Ctrl+L/Ctrl+C and other readline shortcuts now work on non-Latin keyboard layouts (Cyrillic, German, Greek, …).
- ✅ **v0.5.3** — auth-flow polish: registration confirmation banner, password reset, account deletion with org ownership transfer, donate link, branded email templates, recovery from stale/deleted-account sessions.
- ✅ **v0.5.2** — theme persistence fix.
- ✅ **v0.5.1** — three app themes (Midnight / Onyx / Daylight) with paired terminal palettes; clipboard + proxy fixes after the security audit.
- ✅ **v0.5.0** — full security audit: scrypt KDF, master-password verifier, server-side RLS hardening, sandboxed renderer, TOFU host verification, auto-clear clipboard.
