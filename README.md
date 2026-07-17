# claude-config

Personal Claude Code configuration: custom skills, sub-agents, scripts, and integrations.

> **Note:** This repo lives at `~/.claude/` and is loaded automatically by [Claude Code](https://docs.anthropic.com/en/docs/claude-code). The `CLAUDE.md` file provides global instructions to the agent; this README is for human onboarding only and does not affect agent behavior.

---

## Repository Structure

```
~/.claude/
├── skills/          # Custom slash-command skills; dev-pipeline/ is a skills-dir plugin (the whole dev workflow)
├── hooks/           # Global hook scripts (see Hooks)
├── scripts/         # TypeScript utilities (memory, diagrams, capture) — pnpm workspace
├── plugins/         # Installed Claude Code plugins
├── plans/           # Implementation plans (git add -f to track)
├── research/        # Investigation documents (git add -f to track)
├── CLAUDE.md        # Global agent instructions (auto-loaded)
├── settings.json    # Permissions, plugins, hooks, and feature flags
├── keybindings.json # Custom keyboard shortcuts
└── statusline.sh    # Context/cost display for the Claude Code UI
```

## Skills

Skills are invoked via `/skill-name` inside Claude Code. Each lives in `skills/<name>/SKILL.md`. Skills inside the **dev-pipeline plugin** are namespaced `/dev-pipeline:<name>`.

| Skill | Command | Description |
|-------|---------|-------------|
| **Research Codebase** | `/dev-pipeline:research_codebase` | Deep codebase investigation. Spawns parallel sub-agents. Saves to `~/.claude/research/`. |
| **Impact Analysis** | `/dev-pipeline:impact_analysis` | Find all files and lines affected by a proposed change (read-only). |
| **Recall** | `/recall` | Page facts in from the long-term memory graph (`~/memory`) on demand. |
| **Remember** | `/remember` | Persist a durable fact to the memory graph, then normalize, verify, and commit. |

(Not exhaustive — see `skills/` for the full set.)

> **Planning and execution** are not skills. The pipeline — planner (Fable), test-writer, coverage-verifier, adversarial critic — ships as sub-agents in the `dev-pipeline` plugin. End-to-end doc: `skills/dev-pipeline/README.md`.

## Sub-Agents

Pipeline agents live in `skills/dev-pipeline/agents/` and are dispatched as `dev-pipeline:<name>`.

| Agent | Model | Purpose |
|-------|-------|---------|
| **dev-pipeline:planner** | Fable | Produce a detailed, self-contained implementation plan from a brief. The only Fable-pinned agent; dispatched by the orchestrator. |
| **dev-pipeline:test-writer** | inherit | Write the failing test suite from a behavior spec, before implementation (input-partitioned). |
| **dev-pipeline:coverage-verifier** | inherit | Read-only audit: classify each behavior bullet's test coverage as full/partial/missing. |
| **dev-pipeline:critic** | inherit | Adversarial cold review gating phase completion; severity-tagged findings, no praise. |

## Long-Term Memory (iwe)

Long-term memory is an [iwe](https://iwe.md) note-graph at `~/memory` (plain linked Markdown) — **not** Claude Code's native auto-memory.

- The `claude` shell wrapper (defined in the NixOS config) makes this the default for every session: it sets `CC_MEM=map`, disables native auto-memory at runtime (`CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`), and loads the **iwe-memory MCP server** from `scripts/memory/iwe-mcp.json` (launcher: `scripts/memory/iwec-memory.sh`). `claude --native` opts out: native auto-memory, no iwe.
- On session start, a hook injects the graph's `index` map plus a recall protocol. Facts are paged in on demand via the `recall` skill and the `iwe_*` MCP tools — never preloaded.
- Writes go through the `remember` skill; a PostToolUse hook prints a visible `📝 Long-term memory updated` line on every graph write.
- `autoMemoryEnabled: true` stays in `settings.json` on purpose so `--native` sessions still get native memory.

The system's own design doc lives in the library (`pkm/iwe-as-cc-memory`); note-writing conventions in `~/memory/conventions.md`.

## Hooks

Global hooks are registered in `settings.json`; scripts live in `hooks/` (plus the memory hook in `scripts/memory/`). TS hooks run via `tsx` and share types + a stdin reader from `scripts/lib/hooks.ts`; hot-path hooks (fired on every prompt or Bash call) are plain ESM `.js` run via `node` for fast startup.

| Event | Script | Purpose |
|-------|--------|---------|
| PreToolUse (Bash) | `pre-bash-memory-commit-guard.js` | In `~/memory` only: blocks vault-sweeping staging and gates `git commit` on graph integrity (dangling wiki links, inclusion orphans). |
| SessionStart | `scripts/memory/session-start-iwe-memory.ts` | Injects the iwe memory map + recall protocol (`CC_MEM=map` sessions). |
| PostToolUse (iwe writes) | `post-memory-update-transparency.ts` | Emits a user-visible line on each memory-graph write. |
| UserPromptSubmit | `user-prompt-memory-nudge.js` | Nudges the `remember` skill when a prompt carries a durable-fact signal. |

Error convention: PostToolUse hooks exit `1` on unexpected errors (failures stay visible); PreToolUse hooks exit `0` (never block a tool by accident — exit `2` is reserved for intentional blocks). Errors log to `hooks/hook-debug.log`.

## Scripts

TypeScript utilities in `scripts/`, managed as a **pnpm workspace**. Run via `npx tsx <script>`.

- **`mermaid-to-ascii.ts`** — Render ```mermaid blocks in a markdown file to ASCII diagrams
- **`memory/`** — iwe memory integration: SessionStart hook, MCP server config + launcher
- **`lib/`** — Shared hook types and `readHookStdin()`
- **`offscreen-capture/`** — Screenshot GUI apps on a headless sway compositor

### Setup

```bash
cd ~/.claude/scripts
pnpm install
```

## Integrations (MCP)

[Model Context Protocol](https://modelcontextprotocol.io/) servers:

- **iwe-memory** — The `~/memory` knowledge graph (`iwe_find`, `iwe_retrieve`, …). Config in `scripts/memory/iwe-mcp.json`, loaded by the `claude` wrapper (see Long-Term Memory).

## Plans and Research

These directories are git-ignored by default to avoid noise. To track a specific file:

```bash
git add -f plans/2026-03-20-my-plan.md
git add -f research/2026-03-20-my-investigation.md
```

Naming convention: `YYYY-MM-DD-kebab-case-description.md`

## Settings Overview

`settings.json` controls:

- **Permissions** — Which tools Claude Code can use without prompting
- **Plugins** — Marketplace: `code-simplifier`, `caveman`, `lua-lsp`, `pyright-lsp`; local skills-dir: `dev-pipeline`
- **Hooks** — Global hook registrations (see Hooks)
- **Features** — Extended thinking enabled; `autoMemoryEnabled: true`, but the `claude` wrapper disables native memory at runtime in favor of iwe — it only takes effect in `claude --native` sessions
- **Status line** — Custom bash script showing context usage %, cost, and model

`settings.local.json` holds machine-specific overrides (not intended for sharing).

## Workflow Examples

### Planning and Implementing a Feature

The orchestrator gathers context, dispatches the `dev-pipeline:planner` sub-agent (Fable) to write the plan, then executes it phase by phase with the pipeline agents. Full doc: `skills/dev-pipeline/README.md`.

```
# 1. Ask for a plan — just describe the work
Plan: add cursor-based pagination to all listing API endpoints

# The orchestrator will:
# - Ask clarifying questions and gather context (Explore/investigator subagents)
# - Dispatch dev-pipeline:planner (Fable) with a complete brief
# - The planner writes ~/.claude/plans/2026-03-20-add-pagination.md and returns
#   the path + summary (or a NEEDS-CLARIFICATION list)

# 2. Review the plan, iterate until satisfied

# 3. Ask to execute it. Per phase, the orchestrator dispatches:
#    dev-pipeline:test-writer  → tests from the behavior spec (never sees impl notes)
#    dev-pipeline:coverage-verifier → full/partial/missing audit
#    general-purpose implementer → makes the tests pass (tests are the contract)
#    dev-pipeline:critic → cold, severity-tagged gate before "done"
```

### Investigating a Codebase

Use `/dev-pipeline:research_codebase` for deep, documented investigations.

```
# Research how authentication works in the project
/dev-pipeline:research_codebase How does the auth middleware handle token refresh?

# Claude will:
# - Spawn parallel sub-agents (locator, analyzer, pattern-finder)
# - Synthesize findings into a structured document
# - Save to ~/.claude/research/2026-03-20-auth-token-refresh.md
# - Present findings with file:line references
```

### Assessing Impact of a Change

Use `/dev-pipeline:impact_analysis` before refactoring to know exactly what will break.

```
/dev-pipeline:impact_analysis Rename the UserService class to ProfileService

# Claude will:
# - Find every file that imports, references, or tests UserService
# - Classify as: Must change / Should check / Worth reviewing
# - Return a read-only inventory — never modifies files
```

---

## How to Use This Repo

If you want to adopt parts of this configuration:

1. **Fork** this repo
2. Clone into your own `~/.claude/` directory (back up your existing config first)
3. Run `cd ~/.claude/scripts && pnpm install` for script dependencies
4. Customize `CLAUDE.md` and `settings.json` for your own preferences

> **Important:** `CLAUDE.md` is auto-loaded into every Claude Code conversation as system instructions. Keep it focused and concise — bloated instructions consume context and degrade agent performance.

## Claude Code Documentation References

This repo uses several Claude Code extension features. Here are the official docs for each:

| Feature | Used In | Docs |
|---------|---------|------|
| **Features Overview** | — | [Extend Claude Code](https://code.claude.com/docs/en/features-overview) — When to use skills vs agents vs hooks vs MCP |
| **Skills** | `skills/` | [Custom slash commands](https://code.claude.com/docs/en/skills) — `SKILL.md` files, frontmatter, `$ARGUMENTS` |
| **Sub-agents** | `skills/dev-pipeline/agents/` | [Custom subagents](https://code.claude.com/docs/en/sub-agents) — Agent definitions, tools, model selection |
| **Memory & CLAUDE.md** | `CLAUDE.md` | [Memory system](https://code.claude.com/docs/en/memory) — Global/project instructions, auto-memory, `MEMORY.md` |
| **Settings** | `settings.json` | [Configuration](https://code.claude.com/docs/en/settings) — Permissions, features, scopes |
| **MCP Servers** | `scripts/memory/iwe-mcp.json` | [MCP integrations](https://code.claude.com/docs/en/mcp) — Connecting external tool servers |
| **Plugins** | `plugins/` | [Plugin system](https://code.claude.com/docs/en/plugins) — Bundling skills, agents, and hooks |
| **Status Line** | `statusline.sh` | [Custom status bar](https://code.claude.com/docs/en/statusline) — Context usage, cost, model display |
| **Hooks** | `hooks/`, `settings.json` | [Hooks guide](https://code.claude.com/docs/en/hooks-guide) — Pre/post tool execution automation |
