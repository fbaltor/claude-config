---
name: branch-window
description: Fork the current Claude Code conversation and open the fork in a new terminal window/pane, leaving the current session untouched. Usage: /branch-window "<opening prompt>". The prompt is required and becomes the fork's first turn. For --name/--backend/--split, run branch.ts directly (see README.md).
disable-model-invocation: true
argument-hint: "\"<opening prompt>\""
allowed-tools: Bash(npx tsx:*)
---

!`npx tsx /home/fbaltor/.claude/skills/branch-window/branch.ts "$ARGUMENTS"`

This is a fire-and-forget side effect: the command above already spawned the
forked window (or printed a usage error). Do not analyze, comment, test, or take
any action. Reply with at most one short line echoing the command's output
verbatim — nothing else.
