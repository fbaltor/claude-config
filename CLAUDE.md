# Global Rules

## Hooks

Hooks are configured in `~/.claude/settings.json` under the `hooks` key. Shared types and `readHookStdin()` live in `~/.claude/scripts/lib/hooks.ts`. All hooks are TypeScript, run via `npx tsx`.

### Active hooks

| Event | Matcher | Script | Purpose |
|---|---|---|---|
| PreToolUse | Bash | `pre-pr-check-doc-sync.ts` | Blocks `gh pr create` if Linear-linked docs are out of sync |
| PostToolUse | Bash | `post-checkout-update-linear-status.ts` | Moves Linear issue → "Desenvolvimento" on `git checkout`/`switch` |
| PostToolUse | Bash | `post-pr-update-linear-status.ts` | Moves Linear issue → "Code review" on `gh pr create` |

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
- All errors log to `~/.claude/hooks/hook-debug.log` via `logHook()` from the shared lib.
- `readHookStdin()` dumps raw stdin on parse failure for schema change diagnosis.

## Work Cadence

When a task involves multiple discrete deliverables (e.g., audit → plan → issues), produce one artifact at a time and wait for review before continuing. "Proceed" means "do the next step", not "do everything remaining."

## File Organization

- Save research notes, investigation reports, and analysis documents to `/home/fbaltor/.claude/research/` (not the project working directory).
- Save implementation plans to `/home/fbaltor/.claude/plans/`.
- Use descriptive filenames with date prefixes: `YYYY-MM-DD-description.md` (e.g., `2026-03-18-lily-joo-save-error-investigation.md`).

## Pull Requests

- Always create PRs as **draft** (`gh pr create --draft`).
- For PR review operations (fetching, triaging, resolving threads), always use the review scripts via `npm --prefix ~/.claude/scripts/reviews run <script> -- <args>`. Never write raw `gh api graphql` queries for review thread operations. Available scripts: `fetch-reviews`, `check-reviews`, `resolve-threads`.

## Linear Document Sync

When asked to update/push/sync a document to Linear, use the `/linear-push-doc` skill with the file path as argument. When asked to pull/fetch a document from Linear, use `/linear-pull-doc`. For fetching issue context from the current branch, use `/linear --fetch-issue`. These skills live at `~/.claude/skills/linear*/SKILL.md`.
