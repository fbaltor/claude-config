# offscreen-capture

Capture a GUI app **fully off-screen** on this NixOS + GNOME/Wayland box — nothing ever appears
on the visible desktop. All orchestration is TypeScript (run via `npx tsx`); the only Bash is the
tiny config string handed to sway.

## Core principle

GNOME/Wayland forbids reading another app's pixels, and the only sanctioned external capture is the
interactive, whole-screen portal. So we don't capture from outside — we **own the display the app
runs in**: spin up a *headless compositor we control*, launch the app inside it, and capture from
there. No consent UI, because we are the compositor.

## Why sway (and not cage)

The Wayland backend is **headless `sway`**. `cage` was tried first and rejected — it is a bare kiosk
that exports none of the protocols we need:

| Protocol | needed for | cage | sway |
|---|---|---|---|
| `wlr-screencopy` | `grim` capture | ❌ | ✅ |
| `virtual-keyboard` | `wtype` input | ❌ | ✅ |
| `wlr-output-management` | `wlr-randr` sizing | ❌ | ✅ |

sway runs on the wlroots **headless** backend with **hardware GL** (Intel render node), so WebGL/
canvas content (e.g. Obsidian's graph) renders GPU-accelerated — no software-GL hack.

## Usage

```bash
cd ~/.claude/scripts/offscreen-capture
npx tsx cli.ts --backend sway --profile obsidian --vault ~/memory-iwe --view graph --out /tmp/graph.png
# then open /tmp/graph.png
```

Flags: `--backend` (default `sway`), `--profile` (default `obsidian`), `--out` (default
`capture.png`), `--size WxH` (default `1680x1050`), `--settle <ms>`, plus profile flags
(`--vault`, `--view graph|default`).

## Architecture (three orthogonal layers)

```
orchestrator  lifecycle: resolve toolchain -> prepare app -> start backend -> waitStable -> nav -> capture -> teardown
  Backend     owns a headless display + capture/key/type/resize/stop   (src/backends/sway.ts)
  AppProfile  backend-aware launch flags + instance/data isolation + nav (src/profiles/obsidian.ts)
```

- **Readiness** (`src/readiness.ts`) is backend-agnostic: capture frames on a poll and call it
  settled once consecutive frames are byte-identical, with a min-size gate so a blank headless
  output is never mistaken for "ready".
- **Provisioning** (`src/toolchain.ts`) is PATH-first: if the bins aren't present, augment PATH
  once via `nix-shell -p …` and prepend it (host PATH preserved, so `obsidian` stays reachable).

## Tests

```bash
npx tsx test/index.ts   # or: npm test
```

Hermetic unit tests (`node:test`, zero new deps) cover the pure logic and the fs-level behaviour:
key-chord → `wtype` args, arg/size parsing, `resolveToolchain` (PATH-first vs Nix fallback, via an
injected runner), `waitStable` frame-stability (incl. the blank-output guard, via a fake session),
and the Obsidian profile's isolation (Singleton excluded, config repointed to the copy, graph view
applied, **sources never mutated**, cleanup). The sway backend + orchestrator are integration-only
(they need the GUI stack) and are exercised by the live capture run, not this suite.

## Extending

- **New backend** (Xvfb, headless Mutter): implement `Backend` (5 methods) in `src/backends/`,
  register it in `cli.ts`. The orchestrator, readiness, and profiles are unchanged.
- **New app profile**: implement `AppProfile.prepare()` returning `{ launch, nav, cleanup }`.

## Gotchas baked in

- Fresh `--user-data-dir` per run + `Singleton*` filtered from the config copy → no stale
  single-instance lock (which otherwise makes Electron exit instantly with "CLI not enabled").
- Deterministic Wayland socket discovery: sway's own `exec` writes `$WAYLAND_DISPLAY` to a file.
- `wtype` (virtual-keyboard protocol) injects **only** into our compositor — unlike `ydotool`
  (kernel uinput), which would target the real seat and leak onto the visible desktop.
- Sources are never mutated: the vault and the Obsidian config are copied to throwaway dirs.

See also: memory `screenshot-offscreen-gui-nixos.md` (the X11/Xvfb predecessor) and the research
note `~/.claude/research/2026-06-03-pure-wayland-offscreen-capture-research.md`.
