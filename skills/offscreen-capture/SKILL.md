---
description: Screenshot a GUI app fully off-screen (headless sway compositor) on this GNOME/Wayland NixOS box, without touching the visible desktop. Use to visually verify an app's UI (e.g. Obsidian's graph) during a session.
argument-hint: "[--profile obsidian] [--vault <path>] [--view graph|default] [--out <path>] [--size WxH]"
allowed-tools: [Bash, Read]
---

# Off-screen GUI capture

Render and screenshot a GUI app inside a **headless sway compositor we own**, so nothing appears on
the user's real screen. Use this whenever you need to *see* an app's UI to verify a change — and the
normal route (GNOME's portal) is rejected because it is interactive and whole-screen.

Implementation lives at `~/.claude/scripts/offscreen-capture/` (TypeScript). Full rationale in that
README and in memory `screenshot-offscreen-gui-nixos.md`.

## When to use

- "Verify the Obsidian graph / open it and show me", "screenshot app X off-screen", "does this
  render correctly?" — for an app that has a profile here.
- The machine is GNOME on Wayland, where capturing a specific window from outside is blocked; this
  sidesteps it by owning the compositor.

## How to run

```bash
cd ~/.claude/scripts/offscreen-capture
npx tsx cli.ts --backend sway --profile obsidian --vault ~/memory-iwe --view graph --out /tmp/osc.png
```

Then **`Read` the output PNG** to evaluate it. Pick a unique `--out` under `/tmp`.

- `--profile` currently: `obsidian` (opens the global graph by default; `--view default` for the
  last workspace). `--vault <path>` selects the vault (copied, never mutated).
- `--size WxH` (default `1680x1050`), `--settle <ms>` if the UI needs longer to settle.
- The run is self-contained: it provisions sway/grim/wtype/wlr-randr via `nix-shell` if missing,
  copies the app config + data to throwaway dirs, captures, and tears everything down.

## Notes

- Hardware-GL, native Wayland — higher fidelity than the older Xvfb path; the user's running app
  instance and real files are untouched.
- Adding a new app: implement an `AppProfile` in `src/profiles/` and register it in `cli.ts`.
  Adding a new display backend (Xvfb, headless Mutter): implement `Backend` in `src/backends/`.
- If a run fails, the error includes the sway log tail; common cause is a stale instance — rerun.
