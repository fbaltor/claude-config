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

### No new-tab support

A common ask is to open the fork in a **new tab inside the running Ghostty app**
instead of a new window. As of Ghostty 1.3.1 (GTK) this is not possible, by
design — not an oversight in this skill.

Branching requires running a command in the new surface
(`-e claude --resume … --fork-session "<prompt>"`). But passing *any* CLI args
makes Ghostty "assume we want instance-specific configuration" and **disable GTK
single-instance**, so every invocation becomes its own process → a new
top-level window. With single-instance forced on, the GTK `activate` signal
can't carry a command anyway, there is no `--tab`/`--new-tab` flag, and
`+new_tab` doesn't work from the CLI (`ghostty +list-actions` exposes only a
`+new-window` CLI action).

Upstream confirms this:

- [#12136 — CLI: support opening new tabs in an existing window](https://github.com/ghostty-org/ghostty/issues/12136)
  — asked for exactly `ghostty +new-tab -e <cmd>`; **closed as not planned**.
- [#4579 — start a new tab to an existing instance from the command line](https://github.com/ghostty-org/ghostty/discussions/4579)
  — open request; "doesn't exist yet," gated behind a future scripting API.
- [#2353 — Scripting API](https://github.com/ghostty-org/ghostty/discussions/2353)
  — no unified IPC shipped. Linux D-Bus exposes only *new-window*; macOS gained
  AppleScript (App Intents) in 1.3+, but this is Linux/GTK.

There is a D-Bus call that talks to the running instance, but it only opens an
**empty** window — it can't carry the `-e` command or target a tab, so it's
useless for branching:

```bash
gdbus call --session --dest com.mitchellh.ghostty \
  --object-path /com/mitchellh/ghostty \
  --method org.gtk.Actions.Activate new-window '[]' '{}'
```

Re-evaluate if Ghostty ships a parameterized `+new-tab` or a scripting API that
can run a command in a tab of the existing instance. Until then, use a pane
backend (tmux/wezterm/kitty) if you want the fork beside the original instead of
in a separate window.

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
  branch.test.ts       # suites: resolveForkCwd, parseArgs, resolveClaudeBin
  lib/types.test.ts    # suite: forkArgs
  lib/select.test.ts   # suite: select / split reconciliation
```

## Tests

Zero-config: `node:test` + `node:assert`, run through the existing tsx loader (no
package.json, no deps).

```
cd ~/.claude/skills/branch-window && npx tsx --test '**/*.test.ts'
```

`branch.ts` guards `main()` behind an `argv[1] === import.meta.url` check so test
imports never spawn a terminal. `resolveForkCwd` takes a `projectsRoot` param so
its tests run hermetically against a tmpdir, never the real `~/.claude/projects`.
