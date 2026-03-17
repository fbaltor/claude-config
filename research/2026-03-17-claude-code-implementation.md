---
date: 2026-03-17T20:01:12-03:00
researcher: Felipe (fbaltor)
git_commit: 9275bb060eb2cb30767492cc952b14a736ad27f4
branch: main
repository: ~/.claude
topic: "Claude Code Implementation - Current State Documentation"
tags: [research, claude-code, binary, plugins, skills, agents, hooks, configuration, architecture]
status: complete
last_updated: 2026-03-17
last_updated_by: Felipe (fbaltor)
---

# Research: Claude Code Implementation - Current State Documentation

**Date**: 2026-03-17T20:01:12-03:00
**Researcher**: Felipe (fbaltor)
**Git Commit**: 9275bb0
**Branch**: main
**Repository**: ~/.claude (personal config) + Claude Code v2.1.77

## Research Question

Document the current Claude Code implementation: binary structure, configuration system, skills, plugins, agents, hooks, sessions, and all supporting subsystems.

## Summary

Claude Code v2.1.77 is a 225 MB self-contained ELF binary built with **Bun** (the JavaScript/TypeScript runtime). It bundles the Bun runtime with JavaScriptCore (JSC), the V8 Node API compatibility layer, and the full application code into a single executable. The application is organized around a rich configuration hierarchy at `~/.claude/`, with subsystems for skills, plugins (marketplace-based), agents (sub-agent definitions), hooks, sessions, telemetry, and per-project state. It communicates with the Anthropic API using tool-use patterns and manages multiple concurrent sub-agents.

## Detailed Findings

### 1. Binary and Installation Structure

**Location**: `/home/fbaltor/.local/share/claude/versions/`
**Symlink**: `/home/fbaltor/.local/bin/claude` -> `/home/fbaltor/.local/share/claude/versions/2.1.77`

The binary is a **Bun single-executable application**:
- **Format**: ELF 64-bit LSB executable, x86-64
- **Size**: 225 MB (235,864,091 bytes for v2.1.77)
- **Runtime**: Bun (identified by `BUN_1.2`, `__BUN`, `Welcome to Bun v`, `{"method":"Bun.canReload"}`, `// @bun @bun-cjs` strings)
- **JS Engine**: JavaScriptCore (extensive `JSC::` namespace symbols: `JSC::CodeBlock`, `JSC::JSObject`, `JSC::Wasm::`, `JSC::DFG::`, `JSC::FTL::`, `JSC::B3::`)
- **Node API compatibility**: Exports `node_api_*` symbols for Node.js native addon compatibility
- **Dynamic dependencies**: Minimal - only libc, libpthread, libdl, libm, librt (no external Node/V8 dependency)

Version management keeps multiple binaries side-by-side:
- `2.1.75` (235 MB, 2026-03-13)
- `2.1.76` (235 MB, 2026-03-14)
- `2.1.77` (236 MB, 2026-03-17)

The application JavaScript code is bundled/minified inside the binary (visible via `strings` output showing minified JS with variable names like `sAf`, `zgH`, `uZA`, Perfetto tracing code, JSON schema handling, and Anthropic API interaction logic).

### 2. Configuration Directory Structure (`~/.claude/`)

```
~/.claude/
├── .claude/
│   └── settings.local.json       # Machine-local settings overrides
├── .credentials.json              # Authentication credentials (gitignored)
├── .gitignore                     # Tracks only config, commands, agents, plugins, plans, research
├── settings.json                  # Global user settings
├── statusline.sh                  # Custom status line script
├── history.jsonl                  # Command history (5057 entries)
│
├── agents/                        # Sub-agent definitions (5 .md files)
├── skills/                        # Skill definitions (4 directories, each with SKILL.md)
├── plugins/                       # Plugin system (marketplace, cache, config)
├── plans/                         # Implementation plans
├── research/                      # Research documents
│
├── projects/                      # Per-project state (51 project directories)
├── sessions/                      # Active session metadata
├── session-env/                   # Per-session environment snapshots
├── file-history/                  # File version history per session
├── shell-snapshots/               # Shell environment snapshots
├── paste-cache/                   # Clipboard/paste content cache
├── image-cache/                   # Image content cache
├── backups/                       # File backups
├── cache/                         # General cache (changelog.md)
├── tasks/                         # Task system state
└── telemetry/                     # Telemetry data (empty currently)
```

### 3. Settings System

**Global settings** (`~/.claude/settings.json`):
```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "permissions": {
    "allow": ["Read(./**)", "Edit(./**)", "WebSearch", "WebFetch", "Bash(*)"],
    "deny": ["Bash(sudo *)", "Bash(su *)", "Bash(chmod *)", "Bash(chown *)"]
  },
  "hooks": {
    "Stop": [{ "hooks": [{ "type": "prompt", "prompt": "...", "timeout": 30 }] }]
  },
  "statusLine": { "type": "command", "command": "~/.claude/statusline.sh" },
  "enabledPlugins": { "code-simplifier@claude-plugins-official": true },
  "alwaysThinkingEnabled": true,
  "effortLevel": "high",
  "autoMemoryEnabled": true
}
```

**Local settings** (`~/.claude/.claude/settings.local.json`): Contains machine-specific permission overrides (e.g., complex Bash command allowlists). Not tracked by git.

**Permission model**: Uses glob patterns for `allow`/`deny` on tool invocations. Tool names include `Read`, `Edit`, `WebSearch`, `WebFetch`, and `Bash(pattern)`.

### 4. Hooks System

Hooks are event handlers that run at specific lifecycle points. Two handler types observed:

1. **Prompt hooks** (`"type": "prompt"`): Send a prompt to a model for evaluation. Used in the `Stop` hook to detect premature task completion (anti-rationalization check).

2. **Command hooks** (`"type": "command"`): Execute shell commands. Used by plugins like hookify (`python3 ${CLAUDE_PLUGIN_ROOT}/hooks/pretooluse.py`).

Hook events observed:
- `Stop` - Before the assistant stops responding
- `PreToolUse` - Before any tool execution
- `PostToolUse` - After tool execution
- `UserPromptSubmit` - When user submits a prompt
- Other documented events: `PreCompact`, `PostCompact` (mentioned in research docs)

Hooks receive input via stdin (JSON) and output decisions via stdout. The `Stop` hook uses `$ARGUMENTS` to receive the conversation transcript and returns `{"decision": "block", "reason": "..."}` or `{"decision": "allow"}`.

### 5. Skills System

**Location**: `~/.claude/skills/<name>/SKILL.md`

Skills are markdown files with YAML frontmatter that define specialized capabilities. They replace the older `commands/` system. Each skill lives in its own directory.

**Current skills (4)**:

| Skill | Model | Context | Key Features |
|---|---|---|---|
| `research_codebase` | opus | fork | Spawns parallel sub-agents, produces research docs |
| `create_plan` | opus | (default) | Interactive planning with sub-agent research |
| `implement_plan` | (default) | (default) | Phase-by-phase plan implementation |
| `impact_analysis` | opus | fork | Read-only blast-radius analysis |

**SKILL.md frontmatter fields**:
- `description` - Skill description
- `model` - Model to use (opus, sonnet, etc.)
- `argument-hint` - Hint for arguments
- `context` - Context mode (`fork` for isolated context)
- `disable-model-invocation` - Prevents model from being called automatically
- `allowed-tools` - Restrict available tools (e.g., `[Read, Grep, Glob, LS, Write, Edit, Agent, WebSearch, WebFetch, Bash]`)

Skills use `$ARGUMENTS` as a placeholder for user-provided arguments in the prompt body.

### 6. Agents (Sub-agents) System

**Location**: `~/.claude/agents/*.md`

Agents define reusable sub-agent profiles that skills invoke via the `Agent` tool. Each agent has YAML frontmatter and a system prompt.

**Current agents (5)**:

| Agent | Model | Max Turns | Tools | Purpose |
|---|---|---|---|---|
| `codebase-locator` | sonnet | 15 | Grep, Glob, LS | Find WHERE code lives |
| `codebase-analyzer` | sonnet | 20 | Read, Grep, Glob, LS | Understand HOW code works |
| `codebase-pattern-finder` | sonnet | 20 | Grep, Glob, Read, LS | Find existing patterns/examples |
| `impact-analyzer` | opus | 25 | Read, Grep, Glob, LS, Bash(git *) | Exhaustive change impact inventory |
| `web-search-researcher` | sonnet | 20 | WebSearch, WebFetch, TodoWrite, Read, Grep, Glob, LS | Web-based research |

**Agent frontmatter fields**:
- `name` - Agent identifier
- `description` - What the agent does (shown when selecting)
- `tools` - Comma-separated list of available tools
- `model` - Model to use
- `maxTurns` - Maximum conversation turns
- `color` - Terminal color (optional, e.g., `yellow`)

Agents are tool-restricted - each agent can only access the tools listed in its frontmatter. This provides context isolation and security boundaries.

### 7. Plugins System

**Architecture**: Marketplace-based plugin distribution system.

**Directory structure**:
```
~/.claude/plugins/
├── config.json                    # Plugin repositories config
├── installed_plugins.json         # Installed plugin registry
├── blocklist.json                 # Blocked plugins
├── known_marketplaces.json        # Known marketplace registries
├── install-counts-cache.json      # Install count statistics
├── cache/                         # Installed plugin files
│   └── claude-plugins-official/
│       └── code-simplifier/1.0.0/ # Cached installed version
├── marketplaces/                  # Marketplace git repos
│   └── claude-plugins-official/   # Official marketplace (git clone)
│       ├── .claude-plugin/
│       │   └── marketplace.json   # Full plugin catalog
│       ├── plugins/               # 30 official plugins
│       └── external_plugins/      # 13 external/community plugins
└── repos/                         # Custom plugin repos (empty)
```

**Marketplace model**: Marketplaces are git repositories. The official marketplace (`claude-plugins-official`) is cloned from `anthropics/claude-plugins-official`. The `marketplace.json` file catalogs all available plugins with metadata.

**Plugin manifest** (`plugin.json` or `.claude-plugin/plugin.json`):
```json
{
  "name": "plugin-name",
  "description": "...",
  "author": { "name": "...", "email": "..." }
}
```

**Plugin types observed**:

1. **LSP plugins** (12): Integrate language servers for code intelligence
   - typescript-lsp, pyright-lsp, gopls-lsp, rust-analyzer-lsp, clangd-lsp, php-lsp, swift-lsp, kotlin-lsp, csharp-lsp, jdtls-lsp, lua-lsp, ruby-lsp
   - Configured via `lspServers` in marketplace.json with command, args, and file extension mappings

2. **Agent plugins**: Bundle agent definitions
   - code-simplifier, code-review, pr-review-toolkit, feature-dev, playground, etc.

3. **Hook plugins**: Register hooks for lifecycle events
   - hookify (Python-based, 4 hook events), security-guidance

4. **Command plugins**: Add slash commands
   - commit-commands, hookify (has commands: configure, help, hookify, list)

5. **Skill plugins**: Add skills
   - hookify (has skills directory), plugin-dev (has skills directory)

6. **MCP integration plugins**: External tools via MCP servers
   - github, gitlab, playwright, supabase, slack, linear, asana, notion, figma, sentry, firebase, stripe, laravel-boost, context7, greptile, serena, atlassian

**Plugin installation**: When installed, plugin files are copied to `cache/<marketplace>/<plugin>/<version>/`. The `installed_plugins.json` tracks installation metadata including git commit SHA, install date, and project path.

**Plugin blocklist**: `blocklist.json` tracks blocked plugins with reasons (e.g., "security", "just-a-test").

**Most popular plugins** (by install count as of 2026-02-26):
1. frontend-design (211K)
2. context7 (127K)
3. code-review (104K)
4. superpowers (92K)
5. github (92K)

### 8. Session Management

**Sessions**: `~/.claude/sessions/*.json`
```json
{
  "pid": 160667,
  "sessionId": "5ec10e66-8c8c-4af0-bb67-ccf0a39ae393",
  "cwd": "/home/fbaltor",
  "startedAt": 1773788271169
}
```

Sessions are identified by UUID and linked to OS process IDs. Multiple concurrent sessions are supported (4 session files observed).

**Session environment** (`session-env/<session-id>/`): Stores environment state for each session. Currently 7 session-env directories.

**Shell snapshots** (`shell-snapshots/snapshot-bash-<timestamp>-<random>.sh`): Capture complete shell state (aliases, functions, shell options) as base64-encoded bash scripts. These restore the user's shell environment for Bash tool execution.

### 9. Per-Project State

**Location**: `~/.claude/projects/<encoded-path>/`

Project paths are encoded by replacing `/` with `-` (e.g., `/home/fbaltor` becomes `-home-fbaltor`). Currently 51 project directories.

**Per-project contents**:
- `<session-id>.jsonl` - Session transcripts (36 for the home project)
- `<session-id>/` - Session-specific data (sub-agent results, tool results)
- `memory/MEMORY.md` - Project-scoped persistent memory
- `memory/*.md` - Additional memory files
- `sessions-index.json` - Session index

**Memory system**: Auto-memory (`autoMemoryEnabled: true`) persists observations across sessions in `memory/MEMORY.md`. Memory files are markdown with links to related files. A system reminder warns that memories are "point-in-time observations" and may be outdated.

### 10. File History and Backups

**File history** (`file-history/<session-id>/`): Stores versioned snapshots of edited files. Files are identified by hash with version suffixes (e.g., `6ad204b115e4d6ea@v1`, `@v2`, etc., up to `@v6` observed). This enables undo/rollback of file edits within a session.

**Backups** (`backups/`): General file backup storage (currently empty).

### 11. History and Telemetry

**Command history** (`history.jsonl`): JSONL format, 5057 entries. Each entry contains:
```json
{
  "display": "user prompt text",
  "pastedContents": {},
  "timestamp": 1761446197770,
  "project": "/path/to/project"
}
```

**Telemetry** (`telemetry/`): Currently empty directory. The binary contains Perfetto tracing code (visible in strings output: `initializePerfettoTracing`, `API Call` spans with model, prompt_tokens, message_id, is_speculative, query_source).

### 12. Status Line

**Custom status line** (`statusline.sh`): A bash script that receives JSON input via stdin and displays:
- Context window usage percentage (color-coded: green <50%, yellow 50-80%, red >80%)
- Total cost in USD
- Current model display name

Input JSON fields used: `.model.display_name`, `.context_window.used_percentage`, `.cost.total_cost_usd`

### 13. Git Tracking

The `~/.claude/` directory is a git repository tracking configuration files. The `.gitignore` uses a deny-by-default pattern (`*`), explicitly allowing:
- `settings.json`
- `commands/` and `agents/` directories
- `plugins/config.json` and `plugins/installed_plugins.json`
- `plans/` and `research/` directories

Sensitive files (`.credentials.json`, `history.jsonl`, session data, cache) are excluded.

## Architecture Documentation

### Tool System

Claude Code exposes tools to the AI model via the Anthropic API tool-use protocol. Core tools include:
- **File tools**: Read, Edit, Write, Glob, Grep
- **System tools**: Bash, LS
- **Web tools**: WebSearch, WebFetch
- **Agent tools**: Agent (spawn sub-agents), Skill (invoke skills)
- **Task tools**: TaskCreate, TaskUpdate, TaskGet, TaskList
- **Notebook tools**: NotebookEdit
- **Worktree tools**: EnterWorktree, ExitWorktree
- **Scheduling tools**: CronCreate, CronDelete, CronList

Tools have a **deferred loading** mechanism - some tools are listed by name only and their schemas are fetched on demand via `ToolSearch`.

### Context Management

- Auto-compaction at ~95% context usage
- `context: fork` in skill frontmatter creates isolated contexts for sub-agents
- Skill `allowed-tools` restricts tool access per skill invocation
- Agent `maxTurns` limits sub-agent conversation length
- Shell snapshots restore environment state between Bash calls

### Plugin Extension Points

Plugins can extend Claude Code through multiple mechanisms:
1. **Agents** - New sub-agent definitions
2. **Commands** - New slash commands
3. **Skills** - New skill definitions
4. **Hooks** - Lifecycle event handlers (with `${CLAUDE_PLUGIN_ROOT}` variable for paths)
5. **LSP servers** - Language server integrations
6. **MCP servers** - External tool integrations
7. **Matchers** - Pattern matching rules (hookify)
8. **Core modules** - Python/JS modules for hook logic

## Code References

- `~/.local/share/claude/versions/2.1.77` - Main binary (Bun SEA, 225 MB)
- `~/.local/bin/claude` - Symlink to active version
- `~/.claude/settings.json` - Global configuration
- `~/.claude/.claude/settings.local.json` - Machine-local overrides
- `~/.claude/agents/*.md` - 5 sub-agent definitions
- `~/.claude/skills/*/SKILL.md` - 4 skill definitions
- `~/.claude/plugins/marketplaces/claude-plugins-official/.claude-plugin/marketplace.json` - Plugin catalog
- `~/.claude/plugins/installed_plugins.json` - Installed plugin registry
- `~/.claude/plugins/marketplaces/claude-plugins-official/plugins/hookify/hooks/hooks.json` - Example hook configuration
- `~/.claude/statusline.sh` - Status line script
- `~/.claude/projects/-home-fbaltor/memory/MEMORY.md` - Project memory

## Open Questions

1. **Binary internals**: The Bun binary bundles minified JS. The full source code is not publicly available for inspection. Internal module structure (routing, API client, tool execution engine, permission enforcement) cannot be fully documented from the binary alone.

2. **Sandbox mechanism**: The binary contains `NodeVMSpecialSandbox` string, suggesting some form of VM-based sandboxing for code execution, but the exact sandboxing implementation details are not externally visible.

3. **Agent Teams**: Referenced in research docs (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`) but not observed in current configuration. This experimental feature enables shared task lists and inter-agent messaging.

4. **MCP server lifecycle**: How MCP servers from plugins are started, managed, and shut down is not documented in the local configuration files.

5. **Auto-update mechanism**: The binary manages its own versions in `~/.local/share/claude/versions/` but the update trigger and download mechanism are internal to the binary.
