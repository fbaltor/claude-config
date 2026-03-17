---
date: 2026-03-16T20:45:00-03:00
researcher: Felipe (fbaltor)
topic: "Claude Code Context Engineering - Current State and Update Path"
tags: [research, context-engineering, commands, agents, skills, hooks, configuration]
status: complete
last_updated: 2026-03-16
last_updated_by: Felipe (fbaltor)
---

# Research: Claude Code Context Engineering - Current State and Update Path

**Date**: 2026-03-16
**Researcher**: Felipe (fbaltor)

## Research Question

Review the current ~/.claude configs (commands and agents, based on HumanLayer ACE patterns) and find updated resources to modernize them.

## Summary

Your configs are based on the HumanLayer ACE (Advanced Context Engineering) pattern from late 2024/early 2025. The core ACE insight — deliberate context management through Research → Plan → Implement phases with sub-agent isolation — remains valid. However, **Claude Code has productized most of these techniques natively** since then. The biggest architectural change: **Skills (`.claude/skills/`) have superseded custom commands** with additional capabilities, and subagents now have a much richer configuration surface.

## Current Config Inventory

### Commands (5 files in `~/.claude/commands/`)
| File | Based On | Model |
|---|---|---|
| `create_plan.md` | HumanLayer `create_plan.md` | opus |
| `impact_analysis.md` | HumanLayer pattern | opus |
| `implement_plan.md` | HumanLayer `implement_plan.md` | (default) |
| `research_codebase_generic.md` | HumanLayer `research_codebase_generic.md` | opus |
| `research_codebase.md` | HumanLayer `research_codebase.md` | opus |

### Agents (5 files in `~/.claude/agents/`)
| File | Based On | Model |
|---|---|---|
| `codebase-analyzer.md` | HumanLayer `codebase-analyzer.md` | sonnet |
| `codebase-locator.md` | HumanLayer `codebase-locator.md` | sonnet |
| `codebase-pattern-finder.md` | HumanLayer `codebase-pattern-finder.md` | sonnet |
| `impact-analyzer.md` | HumanLayer `impact-analyzer.md` | opus |
| `web-search-researcher.md` | HumanLayer `web-search-researcher.md` | sonnet |

### Settings (`settings.json`)
- `alwaysThinkingEnabled`, `autoMemoryEnabled`, `effortLevel: high`
- Permissions: Read/Edit (./**), WebSearch, WebFetch, Bash(*), deny sudo/su/chmod/chown
- Plugin: `code-simplifier@claude-plugins-official`

## What Has Changed Since ACE

| ACE / Your Current Technique | Native Claude Code Feature Now |
|---|---|
| Manual context compaction | Auto-compaction at 95% + `/compact` + `PreCompact`/`PostCompact` hooks |
| `.claude/commands/` prompt templates | **Skills** (`.claude/skills/<name>/SKILL.md`) with YAML frontmatter, `context: fork`, auto-invocation |
| Sub-agent context isolation via Task | Built-in `Agent` tool (renamed from Task in v2.1.63+) with model routing, `memory:`, `hooks:` fields |
| Research phase isolation | Built-in `Explore` subagent (Haiku, read-only, automatic) |
| Planning phase | `/plan` mode, built-in `Plan` subagent |
| Multi-agent parallelism | Agent Teams (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`) with shared task lists and inter-agent messaging |
| Context status awareness | Custom status lines (`/statusline`), `/context` command |
| No enforcement mechanism for CLAUDE.md | Full hooks system with 20+ event types, 4 handler types |

## New Subagent Frontmatter Fields (Not in Your Configs)

Your agents only use: `name`, `description`, `tools`, `model`, `color`. New fields available:

| Field | Purpose |
|---|---|
| `disallowedTools` | Denylist (alternative to allowlist) |
| `permissionMode` | `default`, `acceptEdits`, `dontAsk`, `bypassPermissions`, `plan` |
| `maxTurns` | Cap on agentic turns |
| `skills` | Preload skill content into subagent context at startup |
| `mcpServers` | MCP servers scoped to this subagent |
| `hooks` | Lifecycle hooks scoped to this subagent |
| `memory` | `user`, `project`, or `local` — enables cross-session persistent memory |
| `background` | `true` to always run as background task |
| `isolation` | `worktree` to run in isolated git worktree |

## New Skills Frontmatter Fields (Commands Don't Have These)

| Field | Purpose |
|---|---|
| `argument-hint` | Autocomplete hint e.g. `[issue-number]` |
| `disable-model-invocation` | `true` = only user can invoke (not Claude automatically) |
| `user-invocable` | `false` = hidden from `/` menu; Claude-only |
| `allowed-tools` | Whitelist tools for this skill without per-use approval |
| `context: fork` | Run skill in an isolated subagent context |
| `agent` | Which subagent type to use with `context: fork` |
| `hooks` | Lifecycle hooks scoped to this skill |

**String substitutions**: `$ARGUMENTS`, `$ARGUMENTS[N]`, `$N`, `${CLAUDE_SESSION_ID}`, `${CLAUDE_SKILL_DIR}`
**Shell preprocessing**: `` !`shell command` `` syntax runs shell commands before prompt is sent.

## Hooks System (Entirely New)

Your config has no hooks. The hooks system makes CLAUDE.md-style instructions **deterministic**:

**4 handler types**: `command` (shell), `http` (POST), `prompt` (LLM eval), `agent` (subagent)

**Key events**: `SessionStart`, `UserPromptSubmit`, `PreToolUse` (can block), `PostToolUse`, `Stop` (can force continuation), `PreCompact`/`PostCompact`, `SubagentStart`/`SubagentStop`, `TaskCompleted`, `InstructionsLoaded`

**Notable community patterns**:
- Trail of Bits anti-rationalization gate: `Stop` hook reviews for cop-outs and forces continuation
- `validate-readonly-query.sh`: `PreToolUse` blocks SQL write operations
- Auto-lint on file save via `PostToolUse`

## `.claude/rules/` Directory (New)

Path-scoped rules that load only when Claude works on matching files:
```markdown
---
paths:
  - "src/api/**/*.ts"
---
# API Rules
- All endpoints must include input validation
```

## Specific Gaps in Your Current Setup

1. **No Skills migration**: Commands still work but miss `context: fork`, auto-invocation, supporting files, shell preprocessing
2. **No hooks**: No deterministic enforcement of rules or quality gates
3. **No `.claude/rules/`**: All instructions are in CLAUDE.md, not modular
4. **No subagent memory**: Agents lose learning between sessions
5. **No statusline**: Context % and cost not visible
6. **No keybindings customization**: Default keybindings only
7. **Missing Agent tool features**: Not using `isolation: worktree`, `background: true`, `maxTurns`
8. **No Agent spawning restrictions**: Your agents can spawn any other agent (use `tools: Agent(specific-agent)` to restrict)

## Recommended Update Path

### Phase 1: Quick Wins (No Restructuring)
- Add new frontmatter fields to existing agents (`maxTurns`, `memory: user` for web-search-researcher)
- Add a statusline script (use `/statusline` to generate one)
- Create `.claude/rules/` for path-scoped rules
- Consider adding `hooks` to `settings.json` for quality gates

### Phase 2: Skills Migration
- Convert commands to skills: `~/.claude/skills/<name>/SKILL.md`
- Add `context: fork` to research/planning skills to isolate their context
- Use `argument-hint` for better autocomplete
- Add shell preprocessing (`` !`command` ``) for dynamic context

### Phase 3: Advanced Features
- Explore Agent Teams for parallel workstreams
- Add `memory: user` to agents that benefit from cross-session learning
- Set up `isolation: worktree` for implementation agents
- Add hooks for enforcement (linting, test running, anti-rationalization)

## Key Resources

### Official Documentation
- [Claude Code Docs](https://code.claude.com/docs/en/overview) — 64 pages, the canonical reference
- [Skills Reference](https://code.claude.com/docs/en/skills)
- [Subagents Reference](https://code.claude.com/docs/en/sub-agents)
- [Hooks Reference](https://code.claude.com/docs/en/hooks)
- [Memory Reference](https://code.claude.com/docs/en/memory)
- [Agent Teams](https://code.claude.com/docs/en/agent-teams)
- [Settings Reference](https://code.claude.com/docs/en/settings)
- [Statusline Reference](https://code.claude.com/docs/en/statusline)
- [Keybindings Reference](https://code.claude.com/docs/en/keybindings)
- [Plugins Reference](https://code.claude.com/docs/en/plugins)
- [Full docs index (llms.txt)](https://code.claude.com/docs/llms.txt)

### Community Repos — Ready-to-Use Configs
- [VoltAgent/awesome-claude-code-subagents](https://github.com/VoltAgent/awesome-claude-code-subagents) — 100+ specialized subagents
- [rohitg00/awesome-claude-code-toolkit](https://github.com/rohitg00/awesome-claude-code-toolkit) — 135 agents, 35 skills, 42 commands, 120+ plugins, 19 hooks
- [hesreallyhim/awesome-claude-code](https://github.com/hesreallyhim/awesome-claude-code) — curated list of skills, hooks, agents, plugins
- [VoltAgent/awesome-agent-skills](https://github.com/VoltAgent/awesome-agent-skills) — 500+ skills from official dev teams
- [anthropics/skills](https://github.com/anthropics/skills) — Anthropic's official public skills repo
- [travisvn/awesome-claude-skills](https://github.com/travisvn/awesome-claude-skills) — curated skills
- [ChrisWiles/claude-code-showcase](https://github.com/ChrisWiles/claude-code-showcase) — comprehensive hooks+skills+agents example
- [disler/claude-code-hooks-mastery](https://github.com/disler/claude-code-hooks-mastery) — hooks mastery
- [feiskyer/claude-code-settings](https://github.com/feiskyer/claude-code-settings) — production settings
- [trailofbits/claude-code-config](https://github.com/trailofbits/claude-code-config) — anti-rationalization hooks
- [FlorianBruniaux/claude-code-ultimate-guide](https://github.com/FlorianBruniaux/claude-code-ultimate-guide)
- [wshobson/commands](https://github.com/wshobson/commands) — production-ready slash commands

### Deep Dives & Guides
- [Claude Skills Deep Dive](https://leehanchung.github.io/blogs/2025/10/26/claude-skills-deep-dive/) — meta-tool architecture internals
- [Skill Authoring Best Practices (Anthropic)](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)
- [Customization Guide: CLAUDE.md vs Skills vs Subagents (alexop.dev)](https://alexop.dev/posts/claude-code-customization-guide-claudemd-skills-subagents/)
- [Sub-Agents Best Practices (PubNub)](https://www.pubnub.com/blog/best-practices-for-claude-code-sub-agents/)
- [Parallel vs Sequential Subagent Patterns (claudefa.st)](https://claudefa.st/blog/guide/agents/sub-agent-best-practices)
- [How I Use Every Claude Code Feature (sshh.io)](https://blog.sshh.io/p/how-i-use-every-claude-code-feature)
- [Claude Code Complete Guide 2026](https://www.jitendrazaa.com/blog/ai/claude-code-complete-guide-2026-from-basics-to-advanced-mcp-2/)

### Statusline Projects
- [sirmalloc/ccstatusline](https://github.com/sirmalloc/ccstatusline) — Rust-based, Powerline support, themes
- [rz1989s/claude-code-statusline](https://github.com/rz1989s/claude-code-statusline) — 18+ atomic components

### HumanLayer (Original Source)
- [HumanLayer ACE Guide](https://github.com/humanlayer/advanced-context-engineering-for-coding-agents/blob/main/ace-fca.md)
- [HumanLayer .claude directory](https://github.com/humanlayer/humanlayer/tree/main/.claude) — 27 commands, 6 agents
- [ACE Blog Post](https://www.humanlayer.dev/blog/advanced-context-engineering)

## Open Questions

- Should commands be migrated to skills now or wait for the full commands deprecation? (Both work, skills take precedence on name conflicts)
- Is Agent Teams stable enough for production use? (Still experimental as of March 2026)
- Which hooks would add the most value to the current workflow?
- Should subagent `memory: user` be added broadly or selectively?
