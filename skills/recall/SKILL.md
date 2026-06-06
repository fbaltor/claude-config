---
description: Recall facts from the long-term iwe memory library (~/memory-iwe) on demand — the user's identity, projects, preferences, machines, tooling, past decisions. Use in iwe-memory sessions (CC_MEM=map) when a relevant fact is not already in context, instead of guessing. Pages notes in via `iwe find` / `iwe retrieve` and follows links.
allowed-tools: [Bash, Read]
---

# Recall — iwe long-term memory (read)

The user's durable memory is the iwe note-graph at `~/memory-iwe`. It is **not** preloaded — only a compact domain map (the `index` MOC) is injected at session start. Page in the actual facts on demand; this is the read half of the iwe memory system (`remember` is the write half).

> **Guard — iwe-memory sessions only.** Run `echo "$CC_MEM"`. If it is not `map` (or `primer`), native memory is active instead — do **not** use this skill.

## When to use
Before answering anything about the user, their projects, preferences, machines, tooling, or past decisions — when you don't already have the fact in context. Do **not** answer from training-data guesses.

## Interface
In `claude --iwe` sessions the graph is exposed as **MCP tools** (`iwe_find`, `iwe_retrieve`, `iwe_tree`, `iwe_stats`) — prefer them. The `iwe …` CLI (run from `~/memory-iwe`) is the exact equivalent and fallback; commands below show the CLI form.

## Procedure
1. **Pick an entry point.** The injected map *is* the `index` MOC — the root of the inclusion tree. `iwe retrieve -k index -d 1` lists the domains; deeper `-d` walks into them. If you know the topic, search instead:
   ```bash
   cd ~/memory-iwe && iwe find "<query>"        # fuzzy match on title/key; -f json for structured
   ```
2. **Budget, then page in the branch.** Children are inclusion edges, so `-d` walks the hub→leaf subtree; `-c` adds parent/backlink context up. Check size first on big hubs:
   ```bash
   cd ~/memory-iwe && iwe retrieve -k <key> -d 2 --dry-run     # documents/lines it would return
   cd ~/memory-iwe && iwe retrieve -k <key> -d 2 -c 1          # then fetch
   ```
   Keys are **root-relative and extensionless** — `me`, `me/profile`, `job-search/panels`.
3. **Widen without re-fetching.** Follow `[[key|Title]]` links and `referencedBy` backlinks; exclude what you already loaded with `-e`:
   ```bash
   cd ~/memory-iwe && iwe retrieve -k <linked-key> -d 1 -e <already-loaded-key>
   ```
4. **Answer from what you paged in**, naming the notes it came from. If `find` surfaces nothing relevant, say the fact **isn't in memory** — never fabricate.

## Notes
- **Ingested notes are canonical** — trust them as the source of truth. **Reference-only notes** (live workspaces, code projects) end with a `gf`-jumpable pointer (e.g. `` `/home/fbaltor/quant/STATUS.md` ``) to a source that stays authoritative — follow it when freshness matters.
- **Hubs are inclusion parents** (ingested docs decompose into an overview + leaves). Page the hub at `-d 1`, read the hooks, then descend the one relevant branch — `--dry-run` before a high `-d` so you don't pull a whole domain.
- Read-only. To persist something new, use the `remember` skill.
