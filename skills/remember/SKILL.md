---
description: Persist a durable fact (user info, correction/preference, project state, reference pointer) to the long-term iwe memory library (~/memory-iwe), following its conventions, then normalize + verify + commit. Use autonomously in iwe-memory sessions (CC_MEM=map) when you learn something worth remembering across sessions.
allowed-tools: [Bash, Read, Edit, Write, Grep]
---

# Remember — iwe long-term memory (write)

Persist a durable fact into the iwe note-graph at `~/memory-iwe` so future sessions can recall it. Write half of the iwe memory system (`recall` is the read half). In `claude --iwe` sessions the `iwe_create` / `iwe_update` / `iwe_extract` / `iwe_rename` / `iwe_normalize` MCP tools write to the graph natively; this skill is the policy layer over them (what to save, where it goes, normalize + verify + commit).

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
- **Link it from that domain's hub as an inclusion edge** — under the hub's `## Notes`, the one-line hook as a paragraph, then the child as an **own-line wiki link**:
  ```markdown
  One-line hook describing the note.

  [[domain/key|Title]]
  ```
  The own-line link is what makes the leaf a graph *child* (so `retrieve -d` pages it). A `- [[key]] — hook` bullet is only an inline reference — no edge. A **cross-domain** pointer (the note's structural home is another domain) stays inline in the hub's `Related:` line instead.
- A genuinely new domain → add a hub note at the root and add it as an **own-line link** in `index.md` (the root MOC / injected map) so the tree stays complete.

## 4. Conventions (full list in `~/memory-iwe/conventions.md`)
- **One physical line per paragraph and bullet** — never hard-wrap (`normalize` joins soft-wrapped lines).
- First `#` heading is the note's **title**; one concept per note; kebab-case keys.
- Cross-refs are **piped wiki links** `[[key|Title]]` — root-relative key, **no `.md`**, and the **display text after `|` must equal the target note's H1 title** (otherwise `normalize` rewrites it or it silently dangles). iwe resolves wiki links by path/basename across the whole vault, so they resolve from any note and survive moves. (Markdown `[](key)` links resolve folder-relative and break for non-root notes — don't use them.)
- **Ingest vs reference (the core model — see `~/memory-iwe/conventions.md`):** settled pure-knowledge → write the **full content** (decompose if >~500 words into leaves under an overview note); **live workspaces & code projects** → a **reference-only summary + pointer**, the repo stays canonical (don't mirror).
- **External resources = `gf`-jumpable absolute paths in inline code** (e.g. `` `/home/fbaltor/quant/STATUS.md` ``). Never markdown-link a local file — `normalize` mangles it (collapses `file://`, strips `.md`, treats bare paths as note-keys). Only web URLs may be markdown links.
- **End with provenance:** ingested → *"Ingested in full from `/abs/path` (settled; wiki canonical)"*; reference-only → *"Canonical source (jump with `gf`): `/abs/path` — summary; edit the source."*

## 5. Normalize + verify
```bash
cd ~/memory-iwe
iwe normalize && git diff --stat                       # canonicalize; review changes
iwe normalize && git diff --quiet && echo "normalize idempotent OK"   # 2nd pass must be a no-op
# link integrity — every [[key]] resolves (the `key`/`note-key`/`wikilink(s)` doc examples are expected):
grep -rhoE '\[\[[a-z0-9][a-z0-9/_-]*(\|[^]]*)?\]\]' --include='*.md' . | sed -E 's/^\[\[//;s/(\|[^]]*)?\]\]$//' | sort -u \
  | while read -r k; do [ -f "$k.md" ] || echo "DANGLING: $k"; done
# reachability — no orphans: reachable keys should equal note files:
echo "reachable=$(iwe tree -f keys -d 12 | sort -u | grep -c .)  files=$(find . -name '*.md' -not -path './.git/*' | grep -vE 'pages/|journals/' | wc -l)"   # find (not git ls-files) so uncommitted new notes count
```
Fix any real `DANGLING` (usually a wrong-folder key or a label ≠ title), and any orphan (link it from a hub).

## 6. Commit
```bash
cd ~/memory-iwe && git add -A && git commit -m "memory(<domain>): <what was remembered>"
```
One commit per remembered fact — keeps history reviewable and each write revertible.
