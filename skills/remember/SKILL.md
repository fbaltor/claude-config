---
description: Persist a durable fact (user info, correction/preference, project state, reference pointer) to the long-term iwe memory library (~/memory), following its conventions, then normalize + verify + commit. Use autonomously in iwe-memory sessions (CC_MEM=map) when you learn something worth remembering across sessions.
allowed-tools: [Bash, Read, Edit, Write, Grep]
---

# Remember — iwe long-term memory (write)

Persist a durable fact into the iwe note-graph at `~/memory` so future sessions can recall it. Write half of the iwe memory system (`recall` is the read half). In iwe-memory sessions (now the default — `claude` without `--native`) the `iwe_create` / `iwe_update` / `iwe_extract` / `iwe_rename` / `iwe_normalize` MCP tools write to the graph natively; this skill is the policy layer over them (what to save, where it goes, normalize + verify + commit).

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
cd ~/memory && iwe find "<topic>"          # already covered?  (also try: grep -ri "<keyword>" .)
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

## 4. Conventions (full list in `~/memory/conventions.md`)
- **One physical line per paragraph and bullet** — never hard-wrap (`normalize` joins soft-wrapped lines).
- First `#` heading is the note's **title**; one concept per note; kebab-case keys.
- Cross-refs are **piped wiki links** `[[key|Title]]` — root-relative key, **no `.md`**, and the **display text after `|` must equal the target note's H1 title** (otherwise `normalize` rewrites it or it silently dangles). iwe resolves wiki links by path/basename across the whole vault, so they resolve from any note and survive moves. (Markdown `[](key)` links resolve folder-relative and break for non-root notes — don't use them.)
- **Ingest vs reference (the core model — see `~/memory/conventions.md`):** settled pure-knowledge → write the **full content** (decompose if >~500 words into leaves under an overview note); **live workspaces & code projects** → a **reference-only summary + pointer**, the repo stays canonical (don't mirror).
- **External resources = `gf`-jumpable absolute paths in inline code** (e.g. `` `/home/fbaltor/quant/STATUS.md` ``). Never markdown-link a local file — `normalize` mangles it (collapses `file://`, strips `.md`, treats bare paths as note-keys). Only web URLs may be markdown links.
- **End with provenance:** ingested → *"Ingested in full from `/abs/path` (settled; wiki canonical)"*; reference-only → *"Canonical source (jump with `gf`): `/abs/path` — summary; edit the source."*

## 5. Verify (read-only — safe under concurrency)
These don't write, so they're safe while other sessions are editing. Run them BEFORE the commit. **Do not run `iwe normalize` here** — it's vault-wide (the CLI has no scope flag), so it runs exactly **once, inside the locked commit** (step 6), to avoid churning other sessions' in-flight notes on every pass.
```bash
cd ~/memory
# link integrity — every [[key]] resolves (the `key`/`note-key`/`wikilink(s)` doc examples are expected):
grep -rhoE '\[\[[a-z0-9][a-z0-9/_-]*(\|[^]]*)?\]\]' --include='*.md' . | sed -E 's/^\[\[//;s/(\|[^]]*)?\]\]$//' | sort -u \
  | while read -r k; do [ -f "$k.md" ] || echo "DANGLING: $k"; done
# inclusion-orphans — every note needs an own-line hub link; orphans show as non-`index` TOP-LEVEL roots
# (do NOT count-compare tree keys vs files — orphans appear as roots, so the counts always match):
iwe tree -f keys -d 12 | grep -v $'^\t' | grep -vx 'index'   # any output = orphan keys
```
Fix any real `DANGLING` (usually a wrong-folder key or a label ≠ title), and any orphan (link it from a hub). These checks are also **hook-enforced at commit time**: `pre-bash-memory-commit-guard.js` blocks a vault `git commit` on any dangling link (vault-wide) or on committing an orphan note (scoped to the commit's paths) — so a skipped verify pass fails loudly instead of landing broken graph state.

## 6. Commit — SCOPED + LOCKED (shared vault)
`~/memory` is written by **multiple concurrent `claude` sessions**. **Never `git add -A` / `git add .` / `git add -u` / `git commit -a` here** — they stage another live session's uncommitted notes into your commit (mis-attribution + the `iwe normalize` flip-flop). A PreToolUse hook (`pre-bash-memory-commit-guard.js`) blocks those forms in this vault (and gates the commit on the step-5 integrity checks); in other repos they're fine.

Stage **only the notes you wrote/edited this turn**, by explicit path, and run normalize + commit under the vault lock so two sessions never interleave:
```bash
cd ~/memory
NOTES="<domain>/<key>.md <hub>.md"   # every note you touched this turn (space-separated)
flock -w 30 .git/cc-mem.lock sh -c "iwe normalize && git add -- $NOTES && git commit -m 'memory(<domain>): <what was remembered>' -- $NOTES"
```
- `git commit -- <paths>` commits only those paths' working-tree contents — it ignores anything else any other session has dirtied or staged (that's why it's safer than `git add <paths>`, which still shares the index).
- `flock -w 30 .git/cc-mem.lock` serializes normalize+commit across sessions (no two normalizes interleave; no `index.lock` collision). It waits ≤30s then fails — retry once or report; never loop.
- `iwe normalize` stays vault-wide (no scope flag). Because you commit only `$NOTES`, its incidental reformatting of OTHER notes is left **uncommitted** for their authors — do **not** `git add` it. For a bulk re-canonicalization, run a standalone `iwe normalize` sweep only when no other session is active.

One commit per remembered fact — keeps history reviewable and each write revertible.
