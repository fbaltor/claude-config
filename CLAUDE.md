# Global Rules

## Environment

This machine runs **NixOS**: `/bin/bash` does not exist (only `/bin/sh`). Any script with shebang `#!/bin/bash` fails with `bad interpreter: No such file or directory` when exec'd directly — by Claude Code (statusLine, hooks), the kernel, or another process. It only appears to work when run as `bash script.sh`, which bypasses the shebang.

**Always use `#!/usr/bin/env bash` (never `#!/bin/bash`)** for shell scripts here. This silently broke the statusLine until the shebang was fixed.

## Memory

Long-term memory on this machine is the **iwe note-graph at `~/memory`** (plain Markdown linked notes), **not** Claude's native auto-memory. This is the **default for every `claude` session**; **`claude --native`** opts out (native auto-memory, no iwe). The `claude` wrapper lives in `~/nixos-config/home/fbaltor/bash/bashrc`.

- **How it loads (default sessions):** the `SessionStart` hook (`session-start-iwe-memory.ts`) injects the `index` MOC **map** + a recall protocol when `CC_MEM=map`; facts are **paged in on demand**, never preloaded. The graph is also the **`iwe-memory` MCP server** (`mcp__iwe-memory__iwe_find` / `iwe_retrieve` / `iwe_create` / …) — prefer those tools over shelling `iwe`.
- **Read/write** via the `recall` and `remember` skills; both gate on `$CC_MEM`, so they no-op under `--native`. Notes are hub→leaf **inclusion trees** (own-line wiki links); `iwe retrieve -k <key> --expand-includes N` pages a branch, starting from `index`.
- **Native memory is off at runtime, not in config:** the wrapper sets `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` per default session, so `/memory` reads "Auto-memory: off". The `autoMemoryEnabled: true` setting is left on **on purpose** so `--native` sessions still get native memory. `/memory` only manages native memory + the `CLAUDE.md` instruction files — it has no awareness of iwe.
- **Reference:** the system's own doc is `pkm/iwe-as-cc-memory` in the library; note-writing conventions are `~/memory/conventions.md`. Runs on iwe **0.16.0** (`iwec`), pinned in `home.nix` (bumped from 0.6.0 on 2026-07-28: file watching fixes stale MCP-server state on external edits; BM25 `--lexical` search; `retrieve` expansion is now explicit `--expand-*` flags — old `-d`/`-c`/`--dry-run` are gone).

## Hooks

Hook scripts live in `/home/fbaltor/.claude/hooks/` and `/home/fbaltor/.claude/scripts/memory/` (the memory hook). TS hooks run via `tsx` and share types + `readHookStdin()` from `/home/fbaltor/.claude/scripts/lib/hooks.ts`; **hot-path** hooks (every prompt/bash) are plain ESM `.js` run via `node` (~40ms startup vs tsx ~250ms), self-contained so they load no shared lib. `hooks/package.json` is `{"type": "module"}`, so plain `.js` there is ESM. All hooks below are **global**, registered in `/home/fbaltor/.claude/settings.json`.

### Global hooks (`~/.claude/settings.json`)

| Event | Script | Purpose |
|---|---|---|
| PreToolUse (`Bash`) | `pre-bash-memory-commit-guard.js` (node) | In `~/memory` only: blocks vault-sweeping staging (`git add -A\|.\|-u`, `commit -a`) AND gates `git commit` on graph integrity — dangling wiki links (vault-wide) and inclusion-orphans (scoped to the committed notes, so other sessions' WIP never blocks). Fail-open on its own errors. |
| SessionStart | `session-start-iwe-memory.ts` (tsx) | Injects the `~/memory` iwe map + recall protocol when `CC_MEM=map` (default sessions — see Memory) |
| PostToolUse (`mcp__iwe-memory__iwe_*` writes) | `post-memory-update-transparency.ts` (tsx) | Emits a user-visible `📝 Long-term memory (~/memory) updated — …` line on each graph write (create/update/extract/rename/delete/inline/squash) — the iwe analog of native "Updating memory". Silent on dry-run/list/interrupted. |
| UserPromptSubmit | `user-prompt-memory-nudge.js` (node) | On a durable-fact signal in the prompt (preference / correction / standing instruction), injects a one-line reminder to consider the `remember` skill. Recall-tuned regex; gated to `CC_MEM` map/primer (fail-open if unset); raises salience only — does **not** force a write. |
| UserPromptSubmit | `user-prompt-caveman-suspend.js` (node) | Suspends caveman for **deep-dive phases** (see Caveman below) — detects research intent, moves the plugin's flag aside, injects a prose-mode counter-instruction. Sticky across bare follow-ups. |

(The caveman plugin also registers `SessionStart` `caveman-activate.js` + `UserPromptSubmit` `caveman-mode-tracker.js` — plugin-managed, run from the plugin cache, nothing in `~/.claude/hooks/` or settings.json. Idiomatic setup is plugin-only; the legacy `--with-hooks` copies were removed 2026-06-10.)

Before writing a new Bash-matcher hook, recall the captured stdin schema from memory (`iwe find hook stdin` → `tooling` branch) — official docs may not match reality. If hooks fail silently, dump stdin with `cat > /tmp/hook-stdin-dump.json`.

## Caveman

Caveman mode is on by default at `lite` (`CAVEMAN_DEFAULT_MODE` in settings.json), but **suspended during deep dives**: its minimalism helps on execution turns and hurts while Felipe is still building a mental model of an unfamiliar domain.

`hooks/user-prompt-caveman-suspend.js` owns this. It is a sticky state machine, one transition per prompt:

- **Enter** on research intent (investigate / research / explain / walk me through / how does / why does / trade-offs / compare / should I …).
- **Stay** on everything else — so bare follow-ups (`why?`, `go on`) don't flip style mid-explanation.
- **Exit** on execution intent (implement / fix / commit / do it / go ahead …) **only when no research signal is also present**. ENTER always beats RESUME, so "explain how to implement X" suspends, and "why does the build fail" stays suspended.

Two enforcement mechanisms, because either alone is insufficient: the hook moves `.caveman-active` aside (stashing the mode in `.caveman-suspend`), which kills the plugin's per-turn reinforcement at the source; and it injects a counter-instruction every suspended turn, because the SessionStart hook has already dumped the full ruleset into context and deleting a file cannot retract that.

Manual control: **"pause caveman"** / **"resume caveman"**. A manual pause ignores the exit heuristic entirely — only an explicit resume (or a `/caveman …` command, which hands control back to the plugin; the informational `/caveman-stats` / `/caveman-help` are excepted and don't lift a suspension) lifts it. Statusline shows `caveman:deep-dive` while suspended.

Never edit the plugin's `SKILL.md` to change this — it lives in the plugin cache and is clobbered on update.

### Error handling convention

- PostToolUse hooks: `process.exit(1)` on unexpected errors — makes failures visible.
- PreToolUse hooks: `process.exit(0)` on unexpected errors — avoids accidentally blocking tool execution. Exit code 2 is reserved for intentional blocks.
- All errors log to `/home/fbaltor/.claude/hooks/hook-debug.log` via `logHook()` from the shared lib.
- `readHookStdin()` dumps raw stdin on parse failure for schema change diagnosis.

## Work Cadence

When a task involves multiple discrete deliverables (e.g., audit → plan → issues), produce one artifact at a time and wait for review before continuing. "Proceed" means "do the next step", not "do everything remaining."

## File Organization — garden vs stream

Every documentation sink is either a **garden** (living, topical files — maintained, expected currently true, staleness is a bug; plain topical names, **no date prefixes**, git carries the dates) or a **stream** (dated snapshots `YYYY-MM-DD-description.md` — true as of their date, **never edited afterward**; supersede with a new dated file that links back). Each level has one garden and typed streams (adopted 2026-07-28; pattern rationale: `/home/fbaltor/skedia/docs/research/2026-07-28-meeting-notes-organization-research.md`).

| Level | Garden | Streams |
|---|---|---|
| Global (cross-project) | `~/memory` (iwe vault, written via the `remember` skill) | `/home/fbaltor/.claude/research/` (cross-project/non-repo investigations) · `/home/fbaltor/.claude/plans/` (plans) |
| Project repo | `<repo>/docs/` (topical, maintained) | `<repo>/docs/research/` (investigations) · other typed streams per repo (e.g. `meetings/`) |

- Investigation docs go to `docs/research/` inside the project repo; use `/home/fbaltor/.claude/research/` only for cross-project or non-repo work. Repos with a legacy flat dated `docs/` migrate opportunistically — new docs follow the pattern regardless.
- Plans always go to `/home/fbaltor/.claude/plans/` — never inside the project repo, never under in-repo `.claude/`.
- **Promotion (stream → garden):** when a snapshot's conclusions become durable, distill them into the right level's garden (a topical `docs/` file, or `~/memory` via `remember`) and cite the snapshot as provenance; never edit the snapshot itself.
- Never create a second global garden (e.g. `~/.claude/docs/`) — the cross-project garden is `~/memory`, where recall works.

## Testing

- Design test specifications (behavior-focused, GIVEN/WHEN/THEN) **before** writing test code or implementation. For a refactor or fix, the test spec is the first artifact.
- Tests for planned code work are written by the separate `dev-pipeline:test-writer` agent, never by the implementer — the test author must not see implementation notes, and the implementer must not weaken tests to get green. Coverage is audited by `dev-pipeline:coverage-verifier`; completion is gated by `dev-pipeline:critic`.
- Full pipeline and role contracts: `~/.claude/skills/dev-pipeline/README.md`.

## Pull Requests

- Always create PRs as **draft** and assign the author (`gh pr create --draft --assignee @me`).

## Diagrams

NEVER hand-write ASCII/Unicode box-drawing diagrams. Always use the mermaid-to-ascii pipeline:

1. Write the diagram in mermaid syntax (in a ```mermaid block inside a .md file)
2. Preview: `npx tsx /home/fbaltor/.claude/scripts/mermaid-to-ascii.ts <file.md>`
3. Convert in-place: `npx tsx /home/fbaltor/.claude/scripts/mermaid-to-ascii.ts <file.md> --write`

The script replaces ```mermaid blocks with rendered ASCII and appends the original mermaid source as an appendix. Powered by the `beautiful-mermaid` npm package (installed in `/home/fbaltor/.claude/scripts/`). Supports: flowcharts, state diagrams, sequence diagrams, class diagrams, ER diagrams, XY charts.

**ER caveat:** ER diagrams render poorly with 3+ entities — cardinality glyphs cramp and connector routing tangles (inherited `mermaid-ascii` layout weakness, not fixable by version bump). Keep ER diagrams to ≤2 entities, or fall back to a markdown table for complex schemas. The other 5 types are production-ready. (Verified 2026-06-14 against beautiful-mermaid 1.1.3, the current latest.)

## Model Tiering

The session model is the **user's** runtime choice — set via `/model`, which persists to `settings.json` (Opus is the usual default; the user deliberately runs Fable sessions at times). The structural division below holds regardless of session model.

- **Planning** → dispatch `dev-pipeline:planner` for any non-trivial change: multiple files, uncertain approach, or unfamiliar code. If you could describe the diff in one sentence, skip planning and just do it. The planner is pinned `model: fable`, so planning gets Fable even in an Opus session. It cannot ask the user questions or spawn sub-agents — clarify with the user and gather context FIRST, then hand it a complete brief. Full pipeline: `~/.claude/skills/dev-pipeline/README.md`.
- **Everything else inherits the session model** — execution, search/explore, review subagents never escalate to a more capable model on their own.
- **Claude never changes the model division:** never run `/model` (it persists to settings.json) and never set `CLAUDE_CODE_SUBAGENT_MODEL`. Model switching is the user's lever, not Claude's.
- **Model-unavailable fallback:** if an assigned model is down/unavailable (e.g. Fable returns "currently unavailable"), fall back to the **next most capable** available model, never a less-capable one — so Fable → **Opus** (NOT Sonnet). Planning still routes through the planner sub-agent; only its model tier changes (pass `model: opus` to the Agent tool). Resume the pinned tier once it's back.
