# claude-config

Personal Claude Code configuration: custom skills, sub-agents, scripts, and integrations.

> **Note:** This repo lives at `~/.claude/` and is loaded automatically by [Claude Code](https://docs.anthropic.com/en/docs/claude-code). The `CLAUDE.md` file provides global instructions to the agent; this README is for human onboarding only and does not affect agent behavior.

---

## Repository Structure

```
~/.claude/
├── skills/          # Custom slash-command skills; dev-pipeline/ is a skills-dir plugin (the whole dev workflow)
├── scripts/         # TypeScript utilities (Linear, GitHub)
├── plugins/         # Installed Claude Code plugins
├── plans/           # Implementation plans (git add -f to track)
├── research/        # Investigation documents (git add -f to track)
├── CLAUDE.md        # Global agent instructions (auto-loaded)
├── settings.json    # Permissions, plugins, and feature flags
└── statusline.sh    # Context/cost display for the Claude Code UI
```

## Skills

Skills are invoked via `/skill-name` inside Claude Code. Each lives in `skills/<name>/SKILL.md`. Skills inside the **dev-pipeline plugin** are namespaced `/dev-pipeline:<name>`.

| Skill | Command | Description |
|-------|---------|-------------|
| **Research Codebase** | `/dev-pipeline:research_codebase` | Deep codebase investigation. Spawns parallel sub-agents. Saves to `~/.claude/research/`. |
| **Impact Analysis** | `/dev-pipeline:impact_analysis` | Find all files and lines affected by a proposed change (read-only). |
| **Linear** | `/linear` | Fetch Linear issues/projects. Auto-detects issue from git branch (e.g. `JUMP-123`). |
| **Linear Push Doc** | `/linear-push-doc` | Sync a local markdown file to a Linear document. |
| **Triage Reviews** | `/triage-reviews` | Classify GitHub PR review comments as Major / Minor / False Positive. |

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

## Scripts

TypeScript utilities in `scripts/`, managed with npm. Run via `npx tsx <script>`.

- **`linear-fetch.ts`** — Fetch Linear issues and projects via the Linear SDK
- **`linear-doc-sync.ts`** — Bi-directional markdown-to-Linear document sync
- **`reviews/`** — GitHub PR review fetching, status checking, and YAML output

### Setup

```bash
cd ~/.claude/scripts
npm install
```

### Environment Variables

The scripts require API keys set as environment variables. Copy the example file and fill in your keys:

```bash
cp ~/.claude/scripts/.env.example ~/.claude/scripts/.env
```

| Variable | Used By | Purpose | Required? |
|----------|---------|---------|-----------|
| `LINEAR_API_KEY` | Linear scripts | General Linear API authentication | Yes, if specific keys below are not set |
| `LINEAR_API_KEY_READ` | Linear scripts | Read-only Linear API access (fetch issues, pull docs) | No — falls back to `LINEAR_API_KEY` |
| `LINEAR_API_KEY_ALL` | Linear scripts | Read+write Linear API access (push docs) | No — falls back to `LINEAR_API_KEY` |
| `GITHUB_TOKEN` | Review scripts | GitHub API authentication (Octokit) | No — falls back to `gh auth token` |

> **Note:** The Linear and Notion **MCP integrations** (used by Claude Code directly) authenticate via OAuth through the plugin system — they do not need environment variables.

## Integrations (MCP)

Configured in `settings.json` via [Model Context Protocol](https://modelcontextprotocol.io/) servers:

- **Linear** — Full read/write (no delete)
- **Notion** — Read/write/create/update (no delete)

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
- **Features** — Extended thinking enabled, high effort level, auto-memory on
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

### Triaging PR Reviews

Use `/triage-reviews` to classify review comments and focus on what matters.

```
# Triage reviews on a specific PR
/triage-reviews --pr 456 --repo org/repo

# Auto-detect PR from current branch (defaults to Jumpstart-Immigration/jumpstart)
/triage-reviews

# Wait for bot reviews (CodeRabbit, Copilot) to finish before triaging
/triage-reviews --wait --pr 456

# Claude will:
# - Fetch all review comments (human + bot)
# - Read the actual source code at each commented location
# - Classify each as Major / Minor / False Positive
# - Present outdated comments separately
# - Ask which items you want to tackle
```

Output looks like:

```
## PR Review Triage

**PR #456**: Add user profile endpoint
**Reviewers**: @alice, @coderabbitai[bot]
**Stats**: 2 major | 3 minor | 1 false positive | 2 outdated

### Major (2)
1. **Missing null check on user lookup** — @alice
   `src/handlers/profile.ts:42` · [link](...)
   > What happens if the user ID doesn't exist?

   **Assessment**: Confirmed — no guard before accessing user properties.
...
```

### Syncing Documents with Linear

Use `/linear-push-doc` for one-way syncs from local markdown to Linear documents.

```
# A Linear-linked doc carries its document ID in frontmatter:
# ---
# linear_document_id: abc123-def456
# linear_document_title: Architecture Overview
# linear_sync_hash: 5a8f5572fdf9
# ---

# After editing locally, push changes back to Linear
/linear-push-doc docs/architecture.md

# Push ALL Linear-linked docs in the repo at once
/linear-push-doc
```

The document ID lives in YAML frontmatter, so pushes don't need an `--id`. A `linear_sync_hash` is written on each push — the pre-PR hook uses it to verify docs are synced before creating a PR (only docs changed on the branch are checked).

### Fetching Linear Issues

Use `/linear` to pull issue or project context into your Claude Code session.

```
# Auto-detect issue from current git branch (parses JUMP-28, GOJ-12, etc.)
/linear --fetch-issue

# Fetch a specific issue
/linear --fetch-issue JUMP-42

# Fetch a project overview with all its issues and docs
/linear --fetch-project "API Redesign"
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
3. Run `cd ~/.claude/scripts && npm install` for script dependencies
4. Set up Linear API keys if using Linear integration
5. Customize `CLAUDE.md` and `settings.json` for your own preferences

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
| **MCP Servers** | `settings.json` | [MCP integrations](https://code.claude.com/docs/en/mcp) — Connecting to Linear, Notion, etc. |
| **Plugins** | `plugins/` | [Plugin system](https://code.claude.com/docs/en/plugins) — Bundling skills, agents, and hooks |
| **Status Line** | `statusline.sh` | [Custom status bar](https://code.claude.com/docs/en/statusline) — Context usage, cost, model display |
| **Hooks** | `settings.json` | [Hooks guide](https://code.claude.com/docs/en/hooks-guide) — Pre/post tool execution automation |
