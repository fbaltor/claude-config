# Modernize ~/.claude Configuration — Implementation Plan

## Overview

Update the personal Claude Code configuration (5 commands, 5 agents, settings.json) to leverage features added since the HumanLayer ACE pattern was published. The configs work well today but miss newer capabilities: richer subagent frontmatter, hooks, `.claude/rules/`, statusline, and the skills system.

## Current State Analysis

- 5 commands in `~/.claude/commands/` — functional, based on HumanLayer ACE (late 2024/early 2025)
- 5 agents in `~/.claude/agents/` — only use `name`, `description`, `tools`, `model`, `color`
- `settings.json` — permissions, auto-memory, code-simplifier plugin, no hooks
- No `.claude/rules/`, no statusline, no keybindings customization
- Research doc: `~/.claude/research/2026-03-16-claude-code-context-engineering-update.md`

## Desired End State

A modernized config that uses the full Claude Code feature surface:
- Agents with `maxTurns`, `memory`, `isolation`, and scoped `hooks` where appropriate
- Commands enriched with all available frontmatter fields
- Hooks in `settings.json` for deterministic quality gates
- `.claude/rules/` for modular, path-scoped instructions
- Statusline for context/cost visibility
- Decision made on whether to migrate commands to skills

## What We're NOT Doing

- Agent Teams (experimental, not stable enough yet)
- Keybindings customization (low priority)
- Plugin development
- Changing the core workflow (Research → Plan → Implement remains the foundation)

## Open Decision: Skills-First Approach

**To discuss before starting implementation.** Two paths:

### Option A: Enrich existing commands/agents first, migrate to skills later
- Lower risk, incremental
- Commands continue working as-is
- Skills migration becomes a separate future phase

### Option B: Migrate to skills first, then enrich
- Skills are the recommended path going forward (commands may be deprecated)
- `context: fork` provides proper isolation (key ACE principle) natively
- Auto-invocation, shell preprocessing (`` !`command` ``), supporting files
- Directory restructure required: `commands/foo.md` → `skills/foo/SKILL.md`
- Richer frontmatter: `argument-hint`, `disable-model-invocation`, `allowed-tools`, `agent`

**Trade-off**: Option B requires more upfront restructuring but avoids doing the work twice. Option A is safer if skills deprecation timeline is unclear.

---

## Phase 1: Enrich Existing Agents

### Overview
Add new frontmatter fields to the 5 existing agents to leverage capabilities they're currently missing.

### Changes Required:

#### 1. All agents — Add `maxTurns`
Prevent runaway agent loops. Suggested values:
- `codebase-locator`: `maxTurns: 15` (search-focused, bounded)
- `codebase-analyzer`: `maxTurns: 20` (needs deeper exploration)
- `codebase-pattern-finder`: `maxTurns: 20`
- `impact-analyzer`: `maxTurns: 25` (exhaustive by design)
- `web-search-researcher`: `maxTurns: 20`

#### 2. `web-search-researcher` — Add `memory: user`
This agent benefits most from cross-session learning (remembering which sources were useful, search strategies that worked).

#### 3. `impact-analyzer` — Add `isolation: worktree`
Impact analysis is read-only but touches many files. Worktree isolation prevents accidental context pollution.

#### 4. Agent spawning restrictions
Consider restricting which agents can spawn other agents via `tools: Agent(specific-agent)` syntax.

### Success Criteria:
- [ ] All agents have `maxTurns` set
- [ ] `web-search-researcher` has `memory: user`
- [ ] `impact-analyzer` has `isolation: worktree`
- [ ] All agents load and function correctly (`/help` shows them)

---

## Phase 2: Enrich Existing Commands

### Overview
Add missing frontmatter fields to commands for better UX and control.

### Changes Required:

#### 1. Add `argument-hint` to all commands
- `create_plan`: `argument-hint: "[ticket-path or description]"`
- `impact_analysis`: `argument-hint: "[change description]"`
- `implement_plan`: `argument-hint: "[plan-path]"`
- `research_codebase`: `argument-hint: "[question or area]"`
- `research_codebase_generic`: `argument-hint: "[question or area]"`

#### 2. Review and update `model` field
Verify model assignments are still optimal with current model lineup (Opus 4.6, Sonnet 4.6, Haiku 4.5).

### Success Criteria:
- [ ] All commands show argument hints in autocomplete
- [ ] Model assignments reviewed and documented

---

## Phase 3: Add Hooks

### Overview
Add deterministic quality gates to `settings.json`.

### Changes Required:

#### 1. Anti-rationalization gate (Stop hook)
Prompt-based hook that catches Claude declaring victory while leaving work undone. Based on Trail of Bits pattern.

#### 2. Consider additional hooks
- `PreToolUse`: Block dangerous operations beyond current deny list
- `PostToolUse`: Auto-lint after file edits (project-specific, may belong in project settings)
- `SessionStart`: Load additional context or env vars

### Success Criteria:
- [ ] At least one Stop hook configured
- [ ] Hooks verified working with `--verbose`

---

## Phase 4: Add `.claude/rules/`

### Overview
Extract reusable rules from CLAUDE.md files into modular, optionally path-scoped rule files.

### Changes Required:

#### 1. Audit existing CLAUDE.md files
Identify rules that apply globally vs. path-specifically.

#### 2. Create rule files
- `~/.claude/rules/general.md` — universal coding rules
- Path-scoped rules as needed (e.g., TypeScript rules for `*.ts` files)

### Success Criteria:
- [ ] At least 2 rule files created
- [ ] Path-scoped rules verified loading only for matching files

---

## Phase 5: Add Statusline

### Overview
Configure a statusline showing context %, cost, and model info.

### Changes Required:

#### 1. Create statusline script
Use `/statusline` to generate or write a custom `~/.claude/statusline.sh`.

#### 2. Configure in settings.json
Add `statusLine` field pointing to the script.

### Success Criteria:
- [ ] Statusline visible showing context %, cost, model
- [ ] Updates after each response

---

## Phase 6: Skills Migration (Future — Pending Decision)

### Overview
Convert `~/.claude/commands/` to `~/.claude/skills/` structure.

### Changes Required:
For each command `foo.md`:
1. Create `~/.claude/skills/foo/SKILL.md`
2. Add new frontmatter fields (`context: fork`, `allowed-tools`, etc.)
3. Move supporting logic or templates into the skill directory
4. Verify `/foo` still works
5. Remove old `~/.claude/commands/foo.md`

### Success Criteria:
- [ ] All 5 commands migrated to skills
- [ ] All `/slash-commands` work identically
- [ ] `context: fork` verified on research/planning skills
- [ ] `commands/` directory removed

---

## References

- Research: `~/.claude/research/2026-03-16-claude-code-context-engineering-update.md`
- Official docs: https://code.claude.com/docs/en/overview
- Skills reference: https://code.claude.com/docs/en/skills
- Subagents reference: https://code.claude.com/docs/en/sub-agents
- Hooks reference: https://code.claude.com/docs/en/hooks
- HumanLayer ACE: https://github.com/humanlayer/advanced-context-engineering-for-coding-agents
- HumanLayer .claude: https://github.com/humanlayer/humanlayer/tree/main/.claude
- Trail of Bits config: https://github.com/trailofbits/claude-code-config
