# branch-window

Forks the current conversation at this point using Claude Code's native
`--fork-session`, then launches the fork in a new terminal surface via a
pluggable backend. The current session keeps running, unchanged.

This is the "fork + open elsewhere" combination that the built-in `/branch`
command does not provide — `/branch` forks in place; this opens the fork in a
separate window or pane.

## Usage

Run the entry script with `npx tsx`:

```bash
npx tsx /home/fbaltor/.claude/skills/branch-window/branch.ts "<prompt>" [--name <label>] [--backend <name>] [--split h|v]
```

- `<prompt>` — **required**. The opening message for the fork (quote it if it
  has spaces). See "Why a prompt is required" below.
- `--name <label>` — optional label shown in the forked session's prompt box.
- `--backend <name>` — force a backend: `ghostty` | `tmux` | `wezterm` | `kitty`.
  Default is auto (see below).
- `--split h|v` — `h` = side-by-side, `v` = stacked. **Pane backends only**
  (tmux/wezterm/kitty). Ignored with a one-time warning on window-only backends
  (ghostty).

Example:

```bash
npx tsx .../branch.ts "explore swapping the cache for redis" --name redis-spike
```

→ new window with the full forked history, Claude works on the redis idea as
the first turn, then the window stays interactive for continued chat. The
original session is untouched.

The script reads `CLAUDE_CODE_SESSION_ID` from the environment to know which
session to fork, and `CLAUDE_CODE_EXECPATH` (falling back to PATH) to find the
`claude` binary. Both are set automatically inside Claude Code.

## Why a prompt is required

The built-in `/branch` slash command can open a fork *idle* (history shown,
cursor waiting, no model turn) because it swaps the session **inside the running
TUI** — it never starts a new process.

This skill spawns a **new** `claude` process, and the CLI's resume path
(`--resume … --fork-session`) **always demands a prompt** — a promptless resume
exits with `No deferred tool marker found in the resumed session`. There is no
CLI flag (in 2.1.158 or, per the changelog, any later version) to open a
resumed/forked session idle from a subprocess.

So the trade is unavoidable: the prompt you pass becomes the fork's first turn.
Afterwards the window stays fully interactive, exactly like a normal session
opened at the branch point — you just spend one opening message to get there.

## Backend selection

1. `--backend` if given (errors if unknown or its binary isn't on PATH).
2. Otherwise the first backend that auto-detects its environment **and** is
   available: `tmux` (`$TMUX` set) → `wezterm` (`$WEZTERM_PANE`) →
   `kitty` (`$KITTY_LISTEN_ON`).
3. Otherwise the default: **ghostty** (new window).

## Capability tiers

Each backend declares a tier so core can warn honestly:

| Backend | Tier        | Splits | Notes |
|---------|-------------|--------|-------|
| ghostty | window-only | —      | No CLI pane IPC; opens a fresh OS window. |
| tmux    | pane        | h, v   | Splits the current pane when inside tmux, else new window. |
| wezterm | pane        | h, v   | Splits when inside wezterm, else new GUI window. (stub) |
| kitty   | pane        | h, v   | Needs `allow_remote_control`. (stub) |

A `--split` request against a window-only (or unsupported) backend warns once
and proceeds.

## Ghostty note

Ghostty is a terminal emulator, not a multiplexer — it has no scriptable
pane-split, so this skill opens a new **window** for it.

By default the ghostty backend passes `--gtk-single-instance=false` to force a
fresh process. This avoids a GTK/D-Bus bug where `ghostty -e <cmd>` can be
routed to an already-running instance with the command payload dropped (you'd
get an empty shell instead of the forked session). If plain `-e` spawns cleanly
on your machine, disable the guard:

```bash
export BRANCH_WINDOW_GHOSTTY_FRESH=0
```

## Adding a backend

1. Create `backends/<name>.ts` exporting a `Backend` (see `lib/types.ts`).
2. Register it in `backends/index.ts` (`BACKENDS` array, ordered by
   auto-detect precedence).

Core (`branch.ts`, `lib/select.ts`) needs no changes.

## Layout

```
branch-window/
  SKILL.md
  branch.ts            # entry: parse args, get SID, select backend, dispatch
  lib/
    types.ts           # Backend / Capabilities / SpawnCtx contract, forkArgs()
    select.ts          # backend resolution + split-vs-capability reconciliation
    util.ts            # hasBin(), warnOnce()
  backends/
    index.ts           # registry + default
    ghostty.ts         # window-only
    tmux.ts            # pane
    wezterm.ts         # pane (stub)
    kitty.ts           # pane (stub)
```
