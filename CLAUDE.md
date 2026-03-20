# Global Rules

## File Organization

- Save research notes, investigation reports, and analysis documents to `/home/fbaltor/.claude/research/` (not the project working directory).
- Save implementation plans to `/home/fbaltor/.claude/plans/`.
- Use descriptive filenames with date prefixes: `YYYY-MM-DD-description.md` (e.g., `2026-03-18-lily-joo-save-error-investigation.md`).

## Pull Requests

- Always create PRs as **draft** (`gh pr create --draft`).

## Linear Document Sync

When asked to update/push/sync a document to Linear, use the `/linear-push-doc` skill with the file path as argument. When asked to pull/fetch a document from Linear, use `/linear-pull-doc`. For fetching issue context from the current branch, use `/linear --fetch-issue`. These skills live at `~/.claude/skills/linear*/SKILL.md`.
