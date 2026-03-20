# claude-config

Personal Claude Code configuration: custom skills, sub-agents, scripts, and integrations.

> **Note:** This repo lives at `~/.claude/` and is loaded automatically by [Claude Code](https://docs.anthropic.com/en/docs/claude-code). The `CLAUDE.md` file provides global instructions to the agent; this README is for human onboarding only and does not affect agent behavior.

---

## Repository Structure

```
~/.claude/
├── agents/          # Sub-agent definitions (spawned by skills)
├── skills/          # Custom slash-command skills
├── scripts/         # TypeScript utilities (Linear, GitHub)
├── plugins/         # Installed Claude Code plugins
├── plans/           # Implementation plans (git add -f to track)
├── research/        # Investigation documents (git add -f to track)
├── CLAUDE.md        # Global agent instructions (auto-loaded)
├── settings.json    # Permissions, plugins, and feature flags
└── statusline.sh    # Context/cost display for the Claude Code UI
```

## Skills

Skills are invoked via `/skill-name` inside Claude Code. Each lives in `skills/<name>/SKILL.md`.

| Skill | Command | Description |
|-------|---------|-------------|
| **Create Plan** | `/create_plan` | Interactive implementation planning with parallel research agents. Saves to `~/plans/`. |
| **Implement Plan** | `/implement_plan` | Phase-by-phase execution of an approved plan with human verification gates. |
| **Impact Analysis** | `/impact_analysis` | Find all files and lines affected by a proposed change (read-only). |
| **Research Codebase** | `/research_codebase` | Deep codebase investigation. Spawns parallel sub-agents. Saves to `~/research/`. |
| **Linear** | `/linear` | Fetch Linear issues/projects. Auto-detects issue from git branch (e.g. `JUMP-123`). |
| **Linear Push Doc** | `/linear-push-doc` | Sync a local markdown file to a Linear document. |
| **Linear Pull Doc** | `/linear-pull-doc` | Pull a Linear document into a local markdown file. |
| **Triage Reviews** | `/triage-reviews` | Classify GitHub PR review comments as Major / Minor / False Positive. |

## Sub-Agents

Defined in `agents/*.md`. These are spawned by skills to run specialized tasks in parallel.

| Agent | Model | Purpose |
|-------|-------|---------|
| **codebase-locator** | Sonnet | Find where files, directories, and components live |
| **codebase-analyzer** | Sonnet | Understand how specific components work |
| **codebase-pattern-finder** | Sonnet | Find existing code patterns and usage examples |
| **impact-analyzer** | Opus | Exhaustive inventory of files affected by a change |
| **web-search-researcher** | Sonnet | Research questions using web search |

All agents operate as **documentarians** — they describe existing code without suggesting improvements unless asked.

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

| Variable | Purpose |
|----------|---------|
| `LINEAR_API_KEY_READ` | Read-only Linear API access (preferred for fetch) |
| `LINEAR_API_KEY_ALL` | Read+write Linear access (used for document push) |
| `LINEAR_API_KEY` | General fallback for Linear API |

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
- **Plugins** — Currently: `code-simplifier`
- **Features** — Extended thinking enabled, high effort level, auto-memory on
- **Status line** — Custom bash script showing context usage %, cost, and model

`settings.local.json` holds machine-specific overrides (not intended for sharing).

## Workflow Examples

### Planning and Implementing a Feature

Use `/create_plan` and `/implement_plan` together for structured, multi-phase work.

```
# 1. Create a plan — Claude researches the codebase and iterates with you
/create_plan Add cursor-based pagination to all listing API endpoints

# Claude will:
# - Spawn sub-agents to find relevant files and patterns
# - Ask clarifying questions
# - Present design options
# - Write a detailed plan to ~/.claude/plans/2026-03-20-add-pagination.md

# 2. Review the plan, suggest changes, iterate until satisfied

# 3. Implement it phase by phase
/implement_plan ~/.claude/plans/2026-03-20-add-pagination.md

# Claude will:
# - Implement Phase 1, run automated verification
# - Pause for you to manually test
# - Continue to Phase 2 after your confirmation
# - Update checkboxes in the plan file as it goes
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

Use `/linear-push-doc` and `/linear-pull-doc` for one-way syncs between local markdown and Linear documents.

```
# Pull a Linear document locally for the first time (needs the document ID)
/linear-pull-doc docs/architecture.md --id abc123-def456

# This creates docs/architecture.md with frontmatter:
# ---
# linear_document_id: abc123-def456
# title: Architecture Overview
# ---

# After editing locally, push changes back to Linear
/linear-push-doc docs/architecture.md

# Pull latest changes from Linear into the local file
/linear-pull-doc docs/architecture.md
```

The document ID is stored in YAML frontmatter after the initial pull, so subsequent syncs don't need `--id`.

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

Use `/research_codebase` for deep, documented investigations.

```
# Research how authentication works in the project
/research_codebase How does the auth middleware handle token refresh?

# Claude will:
# - Spawn parallel sub-agents (locator, analyzer, pattern-finder)
# - Synthesize findings into a structured document
# - Save to ~/.claude/research/2026-03-20-auth-token-refresh.md
# - Present findings with file:line references
```

### Assessing Impact of a Change

Use `/impact_analysis` before refactoring to know exactly what will break.

```
/impact_analysis Rename the UserService class to ProfileService

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
| **Sub-agents** | `agents/` | [Custom subagents](https://code.claude.com/docs/en/sub-agents) — Agent definitions, tools, model selection |
| **Memory & CLAUDE.md** | `CLAUDE.md` | [Memory system](https://code.claude.com/docs/en/memory) — Global/project instructions, auto-memory, `MEMORY.md` |
| **Settings** | `settings.json` | [Configuration](https://code.claude.com/docs/en/settings) — Permissions, features, scopes |
| **MCP Servers** | `settings.json` | [MCP integrations](https://code.claude.com/docs/en/mcp) — Connecting to Linear, Notion, etc. |
| **Plugins** | `plugins/` | [Plugin system](https://code.claude.com/docs/en/plugins) — Bundling skills, agents, and hooks |
| **Status Line** | `statusline.sh` | [Custom status bar](https://code.claude.com/docs/en/statusline) — Context usage, cost, model display |
| **Hooks** | `settings.json` | [Hooks guide](https://code.claude.com/docs/en/hooks-guide) — Pre/post tool execution automation |
