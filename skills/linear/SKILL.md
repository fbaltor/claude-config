---
description: Fetch and interact with Linear issues and projects
disable-model-invocation: false
argument-hint: "[--fetch-issue [ID]] [--fetch-project <name>] [free-form request]"
---

## Linear context

!`npx tsx "$HOME/.claude/scripts/linear-fetch.ts" "$ARGUMENTS"`

## Instructions

You have Linear context above (if any was fetched).

- **No args** — the script prints a usage table. Show it to the user verbatim as help and stop; do not call any tools.
- **`--fetch-issue` / `--fetch-project`** — present the fetched data clearly.
- **Free-form request** (e.g., "show me JUMP-304", "what's the project status?") — prefer the deterministic scripts over the Linear MCP:
  - Single-issue reads → `npx tsx "$HOME/.claude/scripts/linear-fetch.ts" --fetch-issue <ID>` via Bash
  - Project reads → `--fetch-project <name>`
  - Pushing docs → `/linear-push-doc <file>` (wraps `linear-doc-sync.ts`)
  - Fall back to `mcp__linear__*` tools only for operations these scripts don't cover: saving/updating issues, creating comments, status changes, listing/searching beyond a single project, etc.
- Do NOT update Linear issue status without explicit user confirmation.
