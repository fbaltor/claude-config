---
description: Persist a durable fact (user info, correction/preference, project state, reference pointer) to the long-term iwe memory library (~/memory-iwe), following its conventions, then normalize + verify + commit. Use autonomously in iwe-memory sessions (CC_MEM=map) when you learn something worth remembering across sessions.
allowed-tools: [Bash, Read, Edit, Write, Grep]
---

# Remember — iwe long-term memory (write)

Persist a durable fact into the iwe note-graph at `~/memory-iwe` so future sessions can recall it. Write half of the iwe memory system (`recall` is the read half).

> **Guard — iwe-memory sessions only.** Run `echo "$CC_MEM"`. If it is not `map` (or `primer`), native auto-memory is active — do **not** use this skill; let native memory handle it.

## 1. Decide if it's worth saving
Save durable, non-obvious facts (mirrors the native memory taxonomy):
- **user** — who they are, role, preferences, environment.
- **feedback** — how they want me to work (corrections + confirmed approaches); include the **why** and how to apply it.
- **project** — ongoing work, goals, constraints not derivable from code or git. Convert relative dates to absolute.
- **reference** — pointers to external resources (paths, URLs, dashboards, tickets).

**Skip:** transient conversation detail, anything the repo/git already records, and secrets. If unsure, prefer a short note over none — but don't duplicate an existing one (step 2).

## 2. Dedup — update vs create
```bash
cd ~/memory-iwe && iwe find "<topic>"          # already covered?  (also try: grep -ri "<keyword>" .)
```
If an existing note covers it → **update** it (`Edit`/`iwe update`). Otherwise **create** a new leaf.

## 3. Placement (keep the graph connected — no orphans)
- New leaf at `<domain>/<kebab-key>.md` under the right domain (`me`, `machines`, `quant`, `tooling`, `preferences`, `job-search`, …).
- **Link it from that domain's hub note**: add a `- [Title](domain/key) — one-line hook` bullet under the hub's `## Notes`.
- A genuinely new domain → add a hub note at the root and link it from `index.md` (the injected map) so the map stays complete.

## 4. Conventions (full list in `~/memory-iwe/conventions.md`)
- **One physical line per paragraph and bullet** — never hard-wrap (`normalize` joins soft-wrapped lines).
- First `#` heading is the note's **title**; one concept per note; kebab-case keys.
- Cross-refs are **iwe-native** `[Title](key)` — root-relative key, **no `.md`**, and the **link label must equal the target note's H1 title** (otherwise `normalize` rewrites it or it silently dangles).
- Optionally end with a provenance line (e.g. *"Distilled from … / source of truth: `~/path`"*).

## 5. Normalize + verify
```bash
cd ~/memory-iwe
iwe normalize && git diff --stat                       # canonicalize; review changes
iwe normalize && git diff --quiet && echo "normalize idempotent OK"   # 2nd pass must be a no-op
# link integrity — every [](key) resolves (the `key`/`note-key` doc examples are expected):
grep -rhoE '\]\([a-z0-9][a-z0-9/_-]*\)' --include='*.md' . | sed -E 's/^\]\(//;s/\)$//' | sort -u \
  | while read -r k; do [ -f "$k.md" ] || echo "DANGLING: $k"; done
# reachability — no orphans: reachable keys should equal note files:
echo "reachable=$(iwe tree -f keys -d 12 | sort -u | grep -c .)  files=$(git ls-files '*.md' | grep -vE 'pages/|journals/' | wc -l)"
```
Fix any real `DANGLING` (usually a wrong-folder key or a label ≠ title), and any orphan (link it from a hub).

## 6. Commit
```bash
cd ~/memory-iwe && git add -A && git commit -m "memory(<domain>): <what was remembered>"
```
One commit per remembered fact — keeps history reviewable and each write revertible.
