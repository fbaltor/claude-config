---
description: Recall facts from the long-term iwe memory library (~/memory) on demand — the user's identity, projects, preferences, machines, tooling, past decisions. Use in iwe-memory sessions (CC_MEM=map) when a relevant fact is not already in context, instead of guessing. Pages notes in via `iwe find` / `iwe retrieve` and follows links.
allowed-tools: [Bash, Read]
---

# Recall — iwe long-term memory (read)

The user's durable memory is the iwe note-graph at `~/memory`. It is **not** preloaded — only a compact domain map (the `index` MOC) is injected at session start. Page in the actual facts on demand; this is the read half of the iwe memory system (`remember` is the write half).

> **Guard — iwe-memory sessions only.** Run `echo "$CC_MEM"`. If it is not `map` (or `primer`), native memory is active instead — do **not** use this skill.

## When to use
Before answering anything about the user, their projects, preferences, machines, tooling, or past decisions — when you don't already have the fact in context. Do **not** answer from training-data guesses.

## Interface
In iwe-memory sessions (now the default — `claude` without `--native`) the graph is exposed as **MCP tools** (`iwe_find`, `iwe_retrieve`, `iwe_tree`, `iwe_stats`) — prefer them. The `iwe …` CLI (run from `~/memory`) is the exact equivalent and fallback; commands below show the CLI form.

## Procedure
1. **Pick an entry point.** The injected map *is* the `index` MOC — the root of the inclusion tree. `iwe retrieve -k index --expand-includes 1` lists the domains; a deeper `--expand-includes N` walks into them. If you know the topic, search instead:
   ```bash
   cd ~/memory && iwe find --fuzzy "<query>"     # subsequence match on title/key; -f json for structured
   cd ~/memory && iwe find --lexical "<query>"   # BM25 full-text on title+body; both flags together fuse (RRF)
   ```
2. **Budget, then page in the branch.** Children are inclusion edges, so `--expand-includes` walks the hub→leaf subtree; `--expand-included-by` adds parent context up (referencedBy backlinks are on by default). Preview keys first on big hubs:
   ```bash
   cd ~/memory && iwe retrieve -k <key> --expand-includes 2 -f keys                 # which documents it would return
   cd ~/memory && iwe retrieve -k <key> --expand-includes 2 --expand-included-by 1  # then fetch
   ```
   Oversized branch? Bound it instead of guessing: `--max-tokens N` (trims periphery first) or `--max-documents N`.
   Keys are **root-relative and extensionless** — `me`, `me/profile`, `job-search/panels`.
3. **Widen without re-fetching.** Follow `[[key|Title]]` links and `referencedBy` backlinks; exclude what you already loaded with `-e`:
   ```bash
   cd ~/memory && iwe retrieve -k <linked-key> --expand-includes 1 -e <already-loaded-key>
   ```
4. **Answer from what you paged in**, naming the notes it came from. If `find` surfaces nothing relevant, say the fact **isn't in memory** — never fabricate.

## Notes
- **Ingested notes are canonical** — trust them as the source of truth. **Reference-only notes** (live workspaces, code projects) end with a `gf`-jumpable pointer (e.g. `` `/home/fbaltor/quant/STATUS.md` ``) to a source that stays authoritative — follow it when freshness matters.
- **Hubs are inclusion parents** (ingested docs decompose into an overview + leaves). Page the hub at `--expand-includes 1`, read the hooks, then descend the one relevant branch — preview with `-f keys` (or cap with `--max-tokens`) before a deep expand so you don't pull a whole domain.
- Read-only. To persist something new, use the `remember` skill.
