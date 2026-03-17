# Modernize ~/.claude Configuration — Implementation Plan

## Overview

Migrate personal Claude Code config to modern features: enrich agent frontmatter, convert 5 commands into 4 skills (merging the two research commands), add hooks, and set up a statusline. Git history on `~/.claude` serves as the rollback mechanism.

## Current → Target Summary

| Item | Current | Target |
|---|---|---|
| Agents | 5, basic frontmatter (`name`, `description`, `tools`, `model`) | 5, + `maxTurns` on all |
| Commands | 5 files in `commands/` | 0 (removed after migration) |
| Skills | 0 | 4 (consolidated from 5 commands) |
| Hooks | none | anti-rationalization `Stop` hook |
| Statusline | none | context % + cost + model |
| Rules | none | none (revisit per-project) |

### Target Directory Structure

```
~/.claude/
├── agents/
│   ├── codebase-analyzer.md          (+ maxTurns)
│   ├── codebase-locator.md           (+ maxTurns)
│   ├── codebase-pattern-finder.md    (+ maxTurns)
│   ├── impact-analyzer.md            (+ maxTurns)
│   └── web-search-researcher.md      (+ maxTurns)
├── skills/
│   ├── create_plan/SKILL.md          (from commands/create_plan.md)
│   ├── implement_plan/SKILL.md       (from commands/implement_plan.md)
│   ├── impact_analysis/SKILL.md      (from commands/impact_analysis.md)
│   └── research_codebase/SKILL.md    (merged from both research commands)
├── plans/
├── research/
├── memory/
├── settings.json                     (+ hooks)
└── statusline.sh                     (new)
```

## What We're NOT Doing

- **Agent Teams** — still experimental (March 2026)
- **Keybindings** — low priority
- **`.claude/rules/`** — user-level rules are low value; path-scoped rules belong in project repos
- **Plugin development** — code-simplifier plugin stays as-is
- **`memory: user` on agents** — uncertain value, fresh searches/analysis don't benefit from stale memories; can revisit later
- **`isolation: worktree` on agents** — only useful for agents that *write* code in parallel; all current agents are read-only or orchestrators
- **`permissionMode`, `mcpServers`, `background`, `skills` (preloading)** on agents — no current need
- **Core workflow change** — Research → Plan → Implement remains the foundation

---

## Phase 1: Enrich Agents

### Overview

Add `maxTurns` to all 5 agents. This is the only frontmatter addition that provides clear value right now — it prevents runaway loops without changing behavior.

### Changes: Exact Target Frontmatter

Each agent's **body content stays unchanged**. Only the frontmatter block is modified.

#### `codebase-locator.md`
```yaml
---
name: codebase-locator
description: Locates files, directories, and components relevant to a feature or task. Call `codebase-locator` with human language prompt describing what you're looking for. Basically a "Super Grep/Glob/LS tool" — Use it if you find yourself desiring to use one of these tools more than once.
tools: Grep, Glob, LS
model: sonnet
maxTurns: 15
---
```
**Change**: Added `maxTurns: 15` (search-focused, bounded scope).

#### `codebase-analyzer.md`
```yaml
---
name: codebase-analyzer
description: Analyzes codebase implementation details. Call the codebase-analyzer agent when you need to find detailed information about specific components. As always, the more detailed your request prompt, the better! :)
tools: Read, Grep, Glob, LS
model: sonnet
maxTurns: 20
---
```
**Change**: Added `maxTurns: 20` (needs deeper exploration than locator).

#### `codebase-pattern-finder.md`
```yaml
---
name: codebase-pattern-finder
description: codebase-pattern-finder is a useful subagent_type for finding similar implementations, usage examples, or existing patterns that can be modeled after. It will give you concrete code examples based on what you're looking for! It's sorta like codebase-locator, but it will not only tell you the location of files, it will also give you code details!
tools: Grep, Glob, Read, LS
model: sonnet
maxTurns: 20
---
```
**Change**: Added `maxTurns: 20`.

#### `impact-analyzer.md`
```yaml
---
name: impact-analyzer
description: Finds all files and lines affected by a proposed change. Use when you need an exhaustive inventory of what would break or become inconsistent if a rename, move, removal, or refactor were applied. Returns a classified list of file:line references — never modifies anything.
tools: Read, Grep, Glob, LS, Bash(git log *), Bash(git diff *), Bash(git blame *), Bash(git show *), Bash(git branch *)
model: opus
maxTurns: 25
---
```
**Change**: Added `maxTurns: 25` (exhaustive by design, needs more room).

#### `web-search-researcher.md`
```yaml
---
name: web-search-researcher
description: Do you find yourself desiring information that you don't quite feel well-trained (confident) on? Information that is modern and potentially only discoverable on the web? Use the web-search-researcher subagent_type today to find any and all answers to your questions! It will research deeply to figure out and attempt to answer your questions! If you aren't immediately satisfied you can get your money back! (Not really - but you can re-run web-search-researcher with an altered prompt in the event you're not satisfied the first time)
tools: WebSearch, WebFetch, TodoWrite, Read, Grep, Glob, LS
color: yellow
model: sonnet
maxTurns: 20
---
```
**Change**: Added `maxTurns: 20`.

### Success Criteria

- [x] All 5 agents have `maxTurns` in frontmatter
- [ ] Smoke test: spawn each agent with a trivial prompt, confirm it runs and respects the turn limit

---

## Phase 2: Migrate Commands → Skills

### Rationale: Skills-First

Going skills-first because:
1. **Avoids double work** — enriching commands then re-doing it for skills wastes effort
2. **`context: fork`** — gives the context isolation ACE designed for, natively built in
3. **`$ARGUMENTS` + `argument-hint`** — better UX than commands for parameterized invocations
4. **`disable-model-invocation`** — prevents Claude from auto-invoking heavy workflows
5. **`allowed-tools`** — auto-approves Write during research/planning (not in global permissions)
6. **Zero-downtime migration** — skills take precedence over same-named commands; create skill first, verify, then delete command

### Consolidation: Two Research Commands → One Skill

`research_codebase.md` and `research_codebase_generic.md` are ~85% identical. Differences:

| Feature | `research_codebase` | `research_codebase_generic` |
|---|---|---|
| "Documentarian only" framing | Yes (strong) | No |
| GitHub permalinks step | Yes | Yes |
| Metadata gathering step | In doc flow | Separate step |
| Follow-up handling | Yes | Yes |

**Merge strategy**: Use `research_codebase.md` as the base (it's the more complete version). The generic version adds nothing that the detailed version lacks. Result: 1 skill replaces 2 commands.

### Target State: 4 Skills

#### Skill 1: `research_codebase` — Forked, Opus

**File**: `~/.claude/skills/research_codebase/SKILL.md`

```yaml
---
description: Research codebase comprehensively using parallel sub-agents. Produces a structured research document.
model: opus
argument-hint: "[question or area of interest]"
context: fork
disable-model-invocation: true
allowed-tools: [Read, Grep, Glob, LS, Write, Edit, Agent, WebSearch, WebFetch, Bash]
---
```

**Body changes from `research_codebase.md`**:
- Remove "Initial Setup" prompt ("I'm ready to research...") — with `context: fork`, the query comes via `$ARGUMENTS`
- Add at top of instructions: `Research query: $ARGUMENTS`
- Remove "Handle follow-up questions" section — each fork invocation is independent; follow-ups are new invocations referencing the previous research doc
- Keep everything else: documentarian framing, parallel sub-agent strategy, GitHub permalinks, frontmatter template, all guidelines
- Minor: update "Task agents" references to "Agent tool" (cosmetic, reflects current naming)

#### Skill 2: `create_plan` — Main Context, Opus

**File**: `~/.claude/skills/create_plan/SKILL.md`

```yaml
---
description: Create detailed implementation plans with thorough research and iteration
model: opus
argument-hint: "[ticket-path or description]"
disable-model-invocation: true
allowed-tools: [Write]
---
```

**No `context: fork`** — this skill is interactive (asks questions, presents options, iterates with the user). Must run in main conversation context.

**Body changes from `create_plan.md`**: None required. The command body is well-structured and works as-is. Optional cosmetic: update "Task" references to "Agent tool".

#### Skill 3: `implement_plan` — Main Context, No Model Override

**File**: `~/.claude/skills/implement_plan/SKILL.md`

```yaml
---
description: Implement technical plans phase by phase with verification checkpoints
argument-hint: "[plan-path]"
disable-model-invocation: true
---
```

**No `model` field** — intentional. The user picks the model for their session based on task complexity. Implementation should use whatever model is active.

**No `context: fork`** — interactive (implements code, pauses for manual verification between phases).

**No `allowed-tools`** — Edit is already globally permitted; this skill doesn't need Write.

**Body changes from `implement_plan.md`**: None. Works as-is.

#### Skill 4: `impact_analysis` — Forked, Opus

**File**: `~/.claude/skills/impact_analysis/SKILL.md`

```yaml
---
description: Find every file and line affected by a proposed change before making modifications
model: opus
argument-hint: "[change description]"
context: fork
disable-model-invocation: true
allowed-tools: [Read, Grep, Glob, LS, Agent, Bash]
---
```

**Body changes from `impact_analysis.md`**:
- Remove "If no parameter provided" fallback prompt — with `context: fork`, the description comes via `$ARGUMENTS`
- Add at top: `Change to analyze: $ARGUMENTS`
- Keep everything else: parallel impact-analyzer agent spawning, verification, classification, all rules

### Migration Steps (Per Skill)

For each of the 4 skills:
1. Create `~/.claude/skills/<name>/SKILL.md` with target frontmatter + adapted body
2. Test: invoke `/<name>` with a real argument, confirm it works
3. For forked skills (`research_codebase`, `impact_analysis`): verify the fork runs and returns results to main context
4. After ALL 4 skills are verified: delete the corresponding `~/.claude/commands/<name>.md` files
5. After all commands deleted: remove the `~/.claude/commands/` directory

**Important**: Skills take precedence over same-named commands, so step 2 tests the skill even if the command still exists.

### Success Criteria

- [x] 4 skill directories created under `~/.claude/skills/`
- [ ] `/research_codebase "how does auth work"` runs in forked context, writes research doc, returns summary
- [ ] `/create_plan` is interactive (asks questions in main context)
- [ ] `/implement_plan .claude/plans/some-plan.md` runs in main context
- [ ] `/impact_analysis "rename X to Y"` runs in forked context, returns classified report
- [x] All 5 command files removed from `commands/`
- [x] `commands/` directory removed

---

## Phase 3: Settings & Polish

### 3a. Anti-Rationalization Hook

Add a `Stop` hook that catches Claude declaring victory with work left undone. Based on the Trail of Bits pattern.

**Concept** (verify exact field names against [hooks reference](https://code.claude.com/docs/en/hooks) during implementation):

```json
{
  "hooks": {
    "Stop": [
      {
        "type": "prompt",
        "prompt": "Review the assistant's last response. Did it: (1) Declare the task complete while leaving TODOs, placeholder code, or untested changes? (2) Skip a step from the plan because it seemed hard or unclear? (3) Say 'I will do X next' or 'you can do X' without actually doing X? If ANY of the above are true, respond with ONLY the word CONTINUE. Otherwise respond with ONLY the word STOP."
      }
    ]
  }
}
```

The exact schema (field names for the matcher/action that triggers continuation) must be verified against the hooks docs or the Trail of Bits repo before implementation. The prompt content above is final.

### 3b. Statusline

Create `~/.claude/statusline.sh` showing context %, cost, and model. Use the `/statusline` built-in to generate a starter script, then customize if needed.

Add to `settings.json`:
```json
{
  "statusLine": "~/.claude/statusline.sh"
}
```

### 3c. Target `settings.json` (Complete)

```json
{
  "$schema": "https://json-schemastore.org/claude-code-settings.json",
  "alwaysThinkingEnabled": true,
  "autoMemoryEnabled": true,
  "effortLevel": "high",
  "permissions": {
    "allow": [
      "Read(./**)",
      "Edit(./**)",
      "WebSearch",
      "WebFetch",
      "Bash(*)"
    ],
    "deny": [
      "Bash(sudo *)",
      "Bash(su *)",
      "Bash(chmod *)",
      "Bash(chown *)"
    ]
  },
  "enabledPlugins": {
    "code-simplifier@claude-plugins-official": true
  },
  "hooks": {
    "Stop": [
      {
        "type": "prompt",
        "prompt": "..."
      }
    ]
  },
  "statusLine": "~/.claude/statusline.sh"
}
```

**Changes from current**: Added `hooks` and `statusLine`. Everything else unchanged.

### Success Criteria

- [x] Stop hook configured with correct schema (verified against docs)
- [ ] Hook fires on premature completion (test: give Claude a multi-step task, interrupt it, see if hook catches the early stop)
- [x] Statusline visible in Claude Code UI showing context %, cost, model
- [ ] `settings.json` validates against schema

---

## Decisions Log

| Decision | Choice | Rationale |
|---|---|---|
| Skills vs. enrich commands first | Skills-first | Avoids double work; skills have strictly more features |
| Merge 2 research commands | Yes → 1 skill | 85% identical; detailed version subsumes the generic one |
| `context: fork` on research + impact | Yes | One-shot workflows; isolation keeps main context clean |
| `context: fork` on create_plan + implement_plan | No | Interactive workflows need user conversation |
| `memory: user` on agents | Skip for now | Fresh analysis > stale memories; easy to add later |
| `isolation: worktree` on impact-analyzer | Skip | Read-only agent; worktree only helps write-capable agents |
| `.claude/rules/` | Skip | Low value at user level; revisit per-project |
| `model` on implement_plan | Omit (inherit session) | User picks model based on task complexity |
| `disable-model-invocation` | True on all skills | These are deliberate user-initiated workflows |

## References

- Research: `~/.claude/research/2026-03-16-claude-code-context-engineering-update.md`
- Skills reference: https://code.claude.com/docs/en/skills
- Subagents reference: https://code.claude.com/docs/en/sub-agents
- Hooks reference: https://code.claude.com/docs/en/hooks
- Trail of Bits config: https://github.com/trailofbits/claude-code-config
- HumanLayer ACE: https://github.com/humanlayer/advanced-context-engineering-for-coding-agents
