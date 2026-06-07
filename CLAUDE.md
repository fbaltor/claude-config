# Global Rules

## Environment

This machine runs **NixOS**: `/bin/bash` does not exist (only `/bin/sh`). Any script with shebang `#!/bin/bash` fails with `bad interpreter: No such file or directory` when exec'd directly — by Claude Code (statusLine, hooks), the kernel, or another process. It only appears to work when run as `bash script.sh`, which bypasses the shebang.

**Always use `#!/usr/bin/env bash` (never `#!/bin/bash`)** for shell scripts here. This silently broke the statusLine until the shebang was fixed.

## Memory

Long-term memory on this machine is the **iwe note-graph at `~/memory`** (plain Markdown linked notes), **not** Claude's native auto-memory. This is the **default for every `claude` session**; **`claude --native`** opts out (native auto-memory, no iwe). The `claude` wrapper lives in `~/nixos-config/home/fbaltor/bash/bashrc`.

- **How it loads (default sessions):** the `SessionStart` hook (`session-start-iwe-memory.ts`) injects the `index` MOC **map** + a recall protocol when `CC_MEM=map`; facts are **paged in on demand**, never preloaded. The graph is also the **`iwe-memory` MCP server** (`mcp__iwe-memory__iwe_find` / `iwe_retrieve` / `iwe_create` / …) — prefer those tools over shelling `iwe`.
- **Read/write** via the `recall` and `remember` skills; both gate on `$CC_MEM`, so they no-op under `--native`. Notes are hub→leaf **inclusion trees** (own-line wiki links); `iwe retrieve -k <key> -d N` pages a branch, starting from `index`.
- **Native memory is off at runtime, not in config:** the wrapper sets `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` per default session, so `/memory` reads "Auto-memory: off". The `autoMemoryEnabled: true` setting is left on **on purpose** so `--native` sessions still get native memory. `/memory` only manages native memory + the `CLAUDE.md` instruction files — it has no awareness of iwe.
- **Reference:** the system's own doc is `pkm/iwe-as-cc-memory` in the library; note-writing conventions are `~/memory/conventions.md`. Runs on iwe **0.3.2** (`iwec`), pinned in `home.nix`.

## Hooks

Hook scripts live in `/home/fbaltor/.claude/hooks/` and `/home/fbaltor/.claude/scripts/memory/` (the memory hook). TS hooks run via `tsx` and share types + `readHookStdin()` from `/home/fbaltor/.claude/scripts/lib/hooks.ts`; **hot-path** hooks (every prompt/bash) are plain ESM `.mjs` run via `node` (~40ms startup vs tsx ~250ms), self-contained so they load no shared lib. `.mjs` is used because `hooks/package.json` is `type: commonjs` (the caveman plugin's `.js` files need `require`), so `.ts`/`.mjs` are the only ways to get ESM there. All hooks below are **global**, registered in `/home/fbaltor/.claude/settings.json`.

### Global hooks (`~/.claude/settings.json`)

| Event | Script | Purpose |
|---|---|---|
| SessionStart | `session-start-iwe-memory.ts` (tsx) | Injects the `~/memory` iwe map + recall protocol when `CC_MEM=map` (default sessions — see Memory) |
| PostToolUse (`mcp__iwe-memory__iwe_*` writes) | `post-memory-update-transparency.ts` (tsx) | Emits a user-visible `📝 Long-term memory (~/memory) updated — …` line on each graph write (create/update/extract/rename/delete/inline/squash) — the iwe analog of native "Updating memory". Silent on dry-run/list/interrupted. |
| UserPromptSubmit | `user-prompt-memory-nudge.mjs` (node) | On a durable-fact signal in the prompt (preference / correction / standing instruction), injects a one-line reminder to consider the `remember` skill. Recall-tuned regex; gated to `CC_MEM` map/primer (fail-open if unset); raises salience only — does **not** force a write. |

(The caveman plugin also registers `SessionStart` `caveman-activate.js` + `UserPromptSubmit` `caveman-mode-tracker.js` — plugin-managed, not hand-maintained.)

### Hook stdin schema (Bash tool, actual format as of 2026-03-24)

The official docs may not match reality. The types below were captured from the actual hook runner. If hooks start failing silently, dump stdin with `cat > /tmp/hook-stdin-dump.json` to verify.

```typescript
// PreToolUse — tool_response is NOT present
// PostToolUse — all fields present
{
  session_id: string;
  transcript_path: string;
  cwd: string;
  permission_mode: string;
  hook_event_name: "PreToolUse" | "PostToolUse" | "PostToolUseFailure";
  tool_name: string;
  tool_use_id: string;
  tool_input: {
    command: string;       // the Bash command
    description?: string;  // the tool call description
  };
  tool_response: {         // PostToolUse only
    stdout: string;
    stderr: string;
    interrupted: boolean;
    isImage: boolean;
    noOutputExpected: boolean;
  };
}
```

### Error handling convention

- PostToolUse hooks: `process.exit(1)` on unexpected errors — makes failures visible.
- PreToolUse hooks: `process.exit(0)` on unexpected errors — avoids accidentally blocking tool execution. Exit code 2 is reserved for intentional blocks.
- All errors log to `/home/fbaltor/.claude/hooks/hook-debug.log` via `logHook()` from the shared lib.
- `readHookStdin()` dumps raw stdin on parse failure for schema change diagnosis.

## Work Cadence

When a task involves multiple discrete deliverables (e.g., audit → plan → issues), produce one artifact at a time and wait for review before continuing. "Proceed" means "do the next step", not "do everything remaining."

## File Organization

- Save implementation plans to `/home/fbaltor/.claude/plans/`.
- Save research/investigation documents to the project's `docs/` directory when working inside a project repo. Use `/home/fbaltor/.claude/research/` only for cross-project or non-repo investigations.
- Use descriptive filenames with date prefixes: `YYYY-MM-DD-description.md` (e.g., `2026-03-18-lily-joo-save-error-investigation.md`).
- Never save plans or research under `.claude/` within the project repo. Plans go to `/home/fbaltor/.claude/plans/`; investigation docs go to `docs/` in the repo.

## Project Rule Overrides

These personal preferences override conflicting rules in any project-level `AGENTS.md` or `CLAUDE.md`.

- **Task file scratchpad** — Skip the "Task file" rule (create `tasks/<DD-MM-YYYY-task-name>.md` before non-trivial work) found in project AGENTS.md files. I decide manually where to put mid-work artifacts. Use in-conversation state (plans, todos) instead of a `tasks/` scratchpad, and do not treat the absence of a task file as a scope-lock violation.

## Testing

- Design test specifications (behavior-focused, GIVEN/WHEN/THEN) **before** writing test code or implementation.
- When implementing a refactor or fix, propose the test spec as the first step.
- Consider using a separate agent to write tests to avoid contamination — the implementer should not see the spec, only the test file + interface. This prevents tests from being biased by knowledge of the implementation.
- Be comprehensive about edge cases and generate realistic test data.

## Pull Requests

- Always create PRs as **draft** and assign the author (`gh pr create --draft --assignee @me`).
- For PR review operations (fetching, triaging, resolving threads), always use the review scripts via `pnpm --dir /home/fbaltor/.claude/scripts/reviews run <script> -- <args>`. Never write raw `gh api graphql` queries for review thread operations. Available scripts: `fetch-reviews`, `check-reviews`, `resolve-threads`.
- Review triage uses `<reviewer>/<severity>-<n>` IDs (e.g., `cp/med-1`, `cr/high-2`). Reviewers: `cp` (Copilot), `cr` (CodeRabbit), `va` (Vercel Agent), human = first 2-3 letters. Severity: `crit`, `high`, `med`, `min`, `fp`. Format is codified in `/home/fbaltor/.claude/skills/triage-reviews/SKILL.md`.
- Only run `resolve-threads` (including `--list`) after effectively addressing or dismissing a specific comment — never as a speculative scan or sanity check. Skip it entirely for comments that don't have an inline thread (review-summary body nitpicks, PR-level comments): there is nothing to resolve, and probing produces noise.

## Diagrams

NEVER hand-write ASCII/Unicode box-drawing diagrams. Always use the mermaid-to-ascii pipeline:

1. Write the diagram in mermaid syntax (in a ```mermaid block inside a .md file)
2. Preview: `npx tsx /home/fbaltor/.claude/scripts/mermaid-to-ascii.ts <file.md>`
3. Convert in-place: `npx tsx /home/fbaltor/.claude/scripts/mermaid-to-ascii.ts <file.md> --write`

The script replaces ```mermaid blocks with rendered ASCII and appends the original mermaid source as an appendix. Powered by the `beautiful-mermaid` npm package (installed in `/home/fbaltor/.claude/scripts/`). Supports: flowcharts, state diagrams, sequence diagrams, class diagrams, ER diagrams, XY charts.

## Linear Document Sync

When asked to update/push/sync a document to Linear, use the `/linear-push-doc` skill with the file path as argument. For fetching issue context from the current branch, use `/linear --fetch-issue`. These skills live at `/home/fbaltor/.claude/skills/linear*/SKILL.md`.
