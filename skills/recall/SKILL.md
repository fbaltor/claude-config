---
description: Recall facts from the long-term iwe memory library (~/memory-iwe) on demand — the user's identity, projects, preferences, machines, tooling, past decisions. Use in iwe-memory sessions (CC_MEM=map) when a relevant fact is not already in context, instead of guessing. Pages notes in via `iwe find` / `iwe retrieve` and follows links.
allowed-tools: [Bash, Read]
---

# Recall — iwe long-term memory (read)

The user's durable memory is the iwe note-graph at `~/memory-iwe`. It is **not** preloaded — only a ~17-line domain map is injected at session start. Page in the actual facts on demand; this is the read half of the iwe memory system (`remember` is the write half).

> **Guard — iwe-memory sessions only.** Run `echo "$CC_MEM"`. If it is not `map` (or `primer`), native memory is active instead — do **not** use this skill.

## When to use
Before answering anything about the user, their projects, preferences, machines, tooling, or past decisions — when you don't already have the fact in context. Do **not** answer from training-data guesses.

## Procedure (run `iwe` from the library root)
1. **Pick an entry point.** From the injected domain map choose the relevant hub (`me`, `quant`, `machines`, `tooling`, `preferences`, …). If unsure which note, search:
   ```bash
   cd ~/memory-iwe && iwe find "<query>"        # fuzzy match on title/key; add -f json for structured output
   ```
2. **Page in the note + its neighborhood** (children `-d` levels down, parent/backlink context `-c` up):
   ```bash
   cd ~/memory-iwe && iwe retrieve -k <key> -d 2 -c 1
   ```
   Keys are **root-relative and extensionless** — e.g. `me`, `me/profile`, `quant/status`.
3. **Widen by following links.** Note bodies contain `[Title](key)` links and frontmatter `referencedBy` (backlinks). Retrieve the ones you need:
   ```bash
   cd ~/memory-iwe && iwe retrieve -k <linked-key> -d 1 -c 0
   ```
4. **Answer from what you paged in**, naming the notes it came from. If `find` surfaces nothing relevant, say the fact **isn't in memory** — never fabricate.

## Notes
- **Ingested notes are canonical** — trust them as the source of truth. **Reference-only notes** (live workspaces, code projects) end with a `gf`-jumpable pointer (e.g. `` `/home/fbaltor/quant/STATUS.md` ``) to a source that stays authoritative — follow it when freshness matters.
- **Hubs now have deeper subtrees** (ingested docs decompose into an overview + leaves). Retrieve the overview at `-d 1`, then page in the one relevant branch — don't pull a whole domain at high `-d`.
- Read-only. To persist something new, use the `remember` skill.
