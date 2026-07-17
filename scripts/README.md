# ~/.claude/scripts

Personal scripts used by Claude Code skills and hooks. These live outside any project repo so they don't pollute project dependencies.

## Setup

This directory is a pnpm workspace with its own `package.json` and `node_modules/`. After cloning or on a new machine:

```bash
cd ~/.claude/scripts
pnpm install
```

## Dependency management

Scripts here import npm packages (e.g. `beautiful-mermaid`). Dependencies are declared in `package.json` and resolved from the local `node_modules/`.

**Do NOT install these dependencies in project repos.** The skill invocations use absolute paths (`$HOME/.claude/scripts/...`), so Node resolution finds `~/.claude/scripts/node_modules/` regardless of the project's working directory.

Shared dev tooling versions (`tsx`, `@types/node`, `typescript`) are pinned once in the `catalog:` section of `pnpm-workspace.yaml`.

To add a new dependency:

```bash
cd ~/.claude/scripts
pnpm add <package>
```

## Scripts

### `mermaid-to-ascii.ts`

Renders ```mermaid blocks in a markdown file to ASCII diagrams (powered by `beautiful-mermaid`). Preview by default; `--write` converts in-place and appends the mermaid source as an appendix.

```bash
npx tsx ~/.claude/scripts/mermaid-to-ascii.ts <file.md> [--write]
```

### `memory/`

The iwe long-term-memory integration:

- `session-start-iwe-memory.ts` — SessionStart hook; injects the `~/memory` map + recall protocol when `CC_MEM=map`
- `iwe-mcp.json` — MCP server config for `iwe-memory`, loaded by the `claude` wrapper
- `iwec-memory.sh` — MCP launcher; `cd`s into `~/memory` before exec'ing `iwec` (it resolves the graph from the CWD)

### `offscreen-capture/`

Screenshot GUI apps on a headless sway compositor without touching the visible desktop. Used by the `offscreen-capture` skill.

## Shared library

### `lib/hooks.ts`

Shared types + `readHookStdin()` for TypeScript hooks. Hot-path hooks (every prompt / Bash call) are plain ESM `.js` run via `node` and deliberately do not import this — see the **Hooks** section of `~/.claude/CLAUDE.md`.

## Hooks

Hook scripts live in `~/.claude/hooks/` and run via Claude Code's hook system (configured in `~/.claude/settings.json`). Current memory hooks: `post-memory-update-transparency.ts` (announces iwe graph writes with a `📝` line) and `user-prompt-memory-nudge.js` (nudges to persist durable facts). See the **Hooks** section of `~/.claude/CLAUDE.md` for the authoritative table.
