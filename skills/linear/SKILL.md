---
description: Fetch and interact with Linear issues and projects
disable-model-invocation: false
---

## Linear context

!`npx tsx "$HOME/.claude/scripts/linear-fetch.ts" $ARGUMENTS`

## Instructions

You have Linear context above (if any was fetched).

- If the user passed `--fetch-issue` or `--fetch-project`, present the fetched data clearly.
- Otherwise, use any injected context (current branch, issue ID) alongside the user's free-form request to assist them with Linear-related work.
- Do NOT update Linear issue status without explicit user confirmation.
