---
description: Grilling interview that stress-tests a plan/design one question at a time, then routes each crystallized fact to the right sink — the project's in-repo docs (CONTEXT.md / docs/adr) or the long-term iwe memory library (~/memory). Use when the user wants to be grilled on a design inside a code project and have the durable outcomes persisted. Memory-aware fork of mattpocock's grill-with-docs.
allowed-tools: [Bash, Read, Edit, Write, Grep, Glob]
---

# Grill with Memory — interview + dual-sink persistence

Interview the user relentlessly about a plan or design until you reach shared understanding, walking down each branch of the decision tree and resolving dependencies one-by-one. As facts crystallize, persist the durable ones to the **right** of two sinks. Memory-aware fork of mattpocock's `grill-with-docs` — the upstream skill knows only the in-repo sink; this one also routes to the iwe note-graph.

## The interview (upstream core)

- **One question at a time.** Wait for the answer before the next. For each question, give your **recommended** answer so the user can often just say "yes".
- **Explore before asking.** If a question is answerable from the codebase, read the code instead of asking.
- **Challenge terminology.** Flag conflicts between what the user says and existing glossary/code terms immediately; propose precise canonical terms for vague/overloaded words.
- **Test with scenarios.** Stress-test domain relationships with concrete edge cases.
- **Cross-reference code.** Verify claims against the actual implementation; surface contradictions.

Up front, **discover the repo's doc conventions** (see below) and read its `CONTEXT.md` (in multi-context repos, a root `CONTEXT-MAP.md` points to bounded-context dirs) so you grill *against* the existing domain model, not from scratch.

## Discover the repo's doc conventions

Don't assume `docs/adr/` — **detect the repo's actual pattern before writing**, in this order:

1. **Existing ADR dir** — glob for one and reuse it: `docs/adr/`, `doc/adr/`, `docs/decisions/`, `docs/architecture/decisions/`, `adr/`, or an `.adr-dir` file (adr-tools). Match the numbering/template of files already there.
2. **adr-tools config** — if `.adr-dir` exists, its contents name the dir.
3. **CONTEXT.md location** — find every `CONTEXT.md` / `CONTEXT-MAP.md` (`glob **/CONTEXT*.md`); a bounded-context's glossary lives next to its `CONTEXT.md`, not necessarily at repo root.
4. **Nothing exists** — propose a location (default `docs/adr/` + a root `CONTEXT.md`) and **confirm before creating** the first one; from then on follow what you just established.

Cache the resolved paths for the session; route step-1 writes there.

## The two sinks

| Sink | Holds | Canonical | Lifecycle |
|---|---|---|---|
| **Repo docs** — `CONTEXT.md` + the repo's ADR dir (discovered per repo) | Domain language grounded in this repo's code symbols; architecture decisions local to the codebase | The repo | Versioned with the code; shared with collaborators |
| **iwe memory** — `~/memory` via `remember` skill | Cross-cutting / reference-level facts: preferences, identity, machine/tooling details, cross-project decisions, project *status*/pointers | The iwe vault | Spans projects + sessions; personal to fbaltor |

This split is **already mandated by `~/memory/conventions.md`**: *"Code projects → reference-only, never duplicated; the repo is canonical for everything inside it."* So iwe must **never** duplicate code-project internals — this skill only operationalizes that rule live during grilling.

## Routing rubric — apply per fact that crystallizes

1. **Describes the inside of THIS repo** — a domain term grounded in code symbols, bounded-context language, or an architecture decision local to the codebase?
   → **Repo sink.** `CONTEXT.md` glossary entry (canonical term, **zero implementation details**) or — only if all three hold — an ADR in the repo's **discovered** ADR dir (see *Discover the repo's doc conventions*): costly-to-reverse **and** surprising-without-context **and** the result of a genuine trade-off. Skip the ADR otherwise. **Do not write iwe** (convention forbids duplicating code-project content).

2. **Else — durable + cross-cutting/personal**: a preference, identity/background fact, machine/tooling detail, a decision that spans projects, or a reference-level project status/pointer?
   → **iwe sink** via the `remember` skill, into the right domain hub (`preferences`, `tooling`, `me`, `machines`, or the project's reference note like `symphony`).

3. **Else** — ephemeral, only relevant to this conversation → persist nothing; keep it in the chat.

**Split rule** — a fact with both faces gets *split*: the code-coupled definition/decision → repo; the generalizable preference/rationale that outlives the repo → iwe; add a one-way cross-link **iwe → repo path** (the iwe note points at the code; the repo never points back). This mirrors the convention's "reference-only summary + pointer".

**Privacy gate (hard)** — never write identity / health / job-search / personal facts into a repo's `CONTEXT.md` or ADR. The repo is shared; iwe is private. iwe may reference a repo path; a repo doc must never embed private memory.

## Write behavior

- **Repo sink — propose, then write.** These land in the user's git. State the exact glossary line or ADR you'll add and write it after a nod (inline, mid-grill, per upstream — don't batch to the end).
- **iwe sink — autonomous + announced.** When a step-2 fact crystallizes, write it through the `remember` skill without pausing the interview; the `post-memory-update-transparency` hook surfaces the `📝 Long-term memory (~/memory) updated` line, so the user sees it without a confirmation prompt. Consistent with how `remember` already operates autonomously.

> **iwe-sink guard — iwe-memory sessions only.** The iwe branch requires `CC_MEM` = `map` (or `primer`); under `claude --native` the `remember` skill no-ops, so route step-2 facts to the repo only where they fit, else just surface them for the user to capture. The repo sink works in any session.

## Don't reinvent the iwe write

Step-2 writes go **through the `remember` skill**, not raw `iwe_create` — it owns dedup (update vs create), placement (domain hub, own-line inclusion link, no orphans), the `~/memory/conventions.md` formatting, normalize + verify, and the per-domain commit. This skill decides *what* and *which sink*; `remember` executes the iwe write.
