# Screenshots

Drop PNG files here matching these filenames. The site renders its own browser
frame (traffic lights + header) around each image — capture the **content only**,
not the macOS window chrome.

## Required

| File                          | Theme    | What's in it                                                                |
| ----------------------------- | -------- | --------------------------------------------------------------------------- |
| `vaults-midnight.png`         | Midnight | Vaults page (hero shot). Personal workspace, ≥4 servers, search bar visible |
| `vaults.png`                  | Midnight | Same as above (used in features grid)                                       |
| `terminal.png`                | Midnight | Active terminal session, colorful output (`htop`, `git log --color`, etc.)  |
| `sftp.png`                    | Midnight | Dual-panel file manager. Local + remote both populated, no real filenames   |
| `snippets.png`                | Midnight | Snippets panel with ≥3 saved entries; mask values, do not screenshot tokens |

The Themes section uses procedurally-rendered mini-previews (no screenshots needed).

## How to capture (macOS)

1. Open Magic Term, set the right theme (Settings → Appearance).
2. Press **Cmd+Shift+4** (rectangular selection — NOT space/window mode).
3. Drag a tight rectangle starting **just below the title bar** and ending at the
   bottom-right of the window content. You want the inside of the window only.
4. Drop the resulting PNG into this folder with the right filename.

If you accidentally captured a window with frame and shadow:
- Open **Cmd+Shift+5** → Options → uncheck "Show Floating Thumbnail" and "Show Shadow"
- Or: Cmd+Shift+4 + Space (window mode), then **Option-click** to capture without shadow

## Specs

- **PNG** (no JPEG — banding ruins gradients).
- **2x retina recommended:** the image's actual pixel dimensions should be roughly
  2400×1500 for the hero, 1600×1000 for feature shots. Smaller works but looks
  soft on retina screens.
- **Hide sensitive data:** real tokens, IP addresses you don't want public, names
  of internal hosts. Use placeholder names (Keenetic, Raspberry, Zone are fine).
