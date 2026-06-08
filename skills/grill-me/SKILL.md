---
description: Interview the user relentlessly about a plan or design until reaching shared understanding, resolving each branch of the decision tree one question at a time. Use when the user wants to stress-test a plan, get grilled on a design, or says "grill me". General-purpose — works for code and non-code planning alike.
allowed-tools: [Bash, Read, Grep, Glob]
---

# Grill me — alignment interview

Interview me relentlessly about every aspect of this plan until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each question, provide your **recommended** answer.

Ask the questions **one at a time** — wait for the answer before the next.

If a question can be answered by exploring the codebase, explore the codebase instead.

> This is mattpocock's `grill-me`, kept general-purpose: it has **no project-doc sink** (use `grill-with-memory` when you're grilling inside a code repo and want CONTEXT.md / ADR routing). Start from a fully fleshed-out idea or a vague couple of sentences — both work, including non-technical planning.

## After the grill — capture durable outcomes (iwe)

grill-me is often run on *personal* / non-code planning (decisions, preferences, project direction) — exactly the facts that belong in long-term memory and never touch a repo. When the session settles a **durable, cross-cutting** fact — a standing preference, a decision that outlives this conversation, a project status worth recalling next session — consider persisting it via the **`remember`** skill.

- **Gate:** iwe-memory sessions only (`CC_MEM` = `map`/`primer`); under `claude --native` the `remember` skill no-ops — skip the nudge.
- **Light touch:** offer/persist at the *end*, not mid-interview — don't break the relentless one-question-at-a-time flow. `remember` owns the rest (where it goes, dedup, normalize, commit).
- **Skip** ephemeral planning detail and anything code/git already records.
