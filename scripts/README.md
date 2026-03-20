# ~/.claude/scripts

Personal scripts used by Claude Code skills and hooks. These live outside any project repo so they don't pollute project dependencies.

## Setup

This directory has its own `package.json` and `node_modules/`. Sub-packages (like `reviews/`) have their own as well. After cloning or on a new machine:

```bash
cd ~/.claude/scripts
npm install
cd reviews && npm install
```

## Dependency management

Scripts here import npm packages (e.g. `@linear/sdk`). Dependencies are declared in `package.json` and resolved from the local `node_modules/`.

**Do NOT install these dependencies in project repos.** The skill invocations use absolute paths (`$HOME/.claude/scripts/...`), so Node resolution finds `~/.claude/scripts/node_modules/` regardless of the project's working directory.

Sub-packages (like `reviews/`) have their own `package.json` and `node_modules/`. The parent `package.json` delegates to them via `npm --prefix`.

To add a new dependency:

```bash
# Root-level scripts (e.g. linear-fetch.ts)
cd ~/.claude/scripts
npm install <package>

# Sub-packages (e.g. reviews/)
cd ~/.claude/scripts/reviews
npm install <package>
```

## Sub-packages

### `reviews/` — `pr-review-fetcher`

Self-contained package for fetching and analyzing PR review comments from GitHub. Structured as a future-publishable NPM package with its own `package.json`, `tsconfig.json`, and dependencies.

**Setup:**

```bash
cd ~/.claude/scripts/reviews
npm install
```

**Structure:**

- `src/` — library code (importable API)
  - `src/index.ts` — barrel export (public API)
  - `src/fetch-reviews.ts` — fetches reviews, threads, comments via GitHub GraphQL
  - `src/check-reviews.ts` — checks AI review bot status, polling, re-runs
  - `src/check-reviews-renderer.ts` — terminal/plain text display layer
  - `src/shared.ts` — shared types and utilities
  - `src/cli-utils.ts` — CLI argument parsing and GitHub token management
  - `src/queries/` — GraphQL query documents
  - `src/yaml-builder/` — structured YAML output with bot-specific parsers
- `src/cli/` — CLI entry points
  - `src/cli/fetch-reviews.ts` — fetch and save PR review comments
  - `src/cli/check-reviews.ts` — check AI review bot status
- `__tests__/` — test suite (103 tests, Node.js native test runner)

**Usage (direct):**

```bash
cd ~/.claude/scripts/reviews
npm run fetch-reviews -- --pr 39
npm run check-reviews -- --pr 39 --wait
npm test
```

**Usage (from parent):**

```bash
cd ~/.claude/scripts
npm run fetch-reviews -- --pr 39
npm run test:reviews
```

**Invoked by:** `.claude/skills/triage-reviews/SKILL.md` in any project repo, via:
```
npx tsx "$HOME/.claude/scripts/reviews/src/cli/fetch-reviews.ts" --pr PR --repo OWNER/REPO
```

**Requires:** `GITHUB_TOKEN` env var or `gh` CLI authenticated with repo access.

## Scripts

### `linear-fetch.ts`

Fetches Linear issues and projects for the `/linear` Claude Code skill.

**Requires:** `LINEAR_API_KEY` environment variable.

**Usage (via skill):**
- `/linear --fetch-issue` -- fetches issue from current branch name (parses `JUMP-28` or `GOJ-12` patterns)
- `/linear --fetch-issue JUMP-28` -- fetches a specific issue
- `/linear --fetch-project <name>` -- fetches project overview with issues and docs

**Invoked by:** `.claude/skills/linear/SKILL.md` in any project repo, via:
```
!`npx tsx "$HOME/.claude/scripts/linear-fetch.ts" $ARGUMENTS`
```

**Issues resolved (2026-03-19):**

1. **`$CLAUDE_PROJECT_DIR` not available** -- The skill originally used `$CLAUDE_PROJECT_DIR/.claude/scripts/linear-fetch.ts` but that env var resolves to empty in skill shell commands. Fixed by using `$HOME/.claude/scripts/` with an absolute path.

2. **`@linear/sdk` not installed** -- The script was initially placed inside a project repo's `.claude/scripts/` with no corresponding dependency. Installing it in the project's `package.json` is wrong (pollutes the repo). Fixed by giving `~/.claude/scripts/` its own `package.json` with `@linear/sdk`.

3. **`identifier` filter not supported in `@linear/sdk` v78** -- `client.issues({ filter: { identifier: { eq: "JUMP-28" } } })` throws a GraphQL error because `identifier` is not a valid `IssueFilter` field. Fixed by splitting the identifier into team key + number and filtering with `{ team: { key: { eq: "JUMP" } }, number: { eq: 28 } }`.
