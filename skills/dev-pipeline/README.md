# dev-pipeline

The dev workflow as one versioned unit — a skills-directory plugin (`dev-pipeline@skills-dir`, auto-loaded from this folder, no install step). This is the discipline kernel of the retired `meta-workflow` skill, promoted to first-class agents; the orchestration shell (status.yaml, contract-confirmation ceremony, resume protocol) was dropped after usage evidence showed ~30 plans produced vs 1 shell run — the agents follow the discipline without the machinery.

## Components

| Component | Invoke as | Role |
|---|---|---|
| `agents/planner.md` | `dev-pipeline:planner` (Fable) | Complete, self-contained implementation plan from a brief |
| `agents/test-writer.md` | `dev-pipeline:test-writer` | Failing test suite from a behavior spec, before implementation |
| `agents/coverage-verifier.md` | `dev-pipeline:coverage-verifier` | Read-only full/partial/missing audit of test coverage |
| `agents/critic.md` | `dev-pipeline:critic` | Adversarial cold review gating completion |
| `skills/research_codebase/` | `/dev-pipeline:research_codebase` | Parallel-subagent codebase investigation → research doc |
| `skills/impact_analysis/` | `/dev-pipeline:impact_analysis` | Read-only blast-radius inventory for a proposed change |

Editing any file here requires `/reload-plugins` or a new session to take effect. There is no implementer agent: implementation runs as `general-purpose` under the rules below.

## The pipeline

**0. Intake & clarify** — orchestrator. Ask the user clarifying questions (`AskUserQuestion`); gather context with `Explore` / `cavecrew-investigator`; for unfamiliar territory run `/dev-pipeline:research_codebase`, for risky refactors `/dev-pipeline:impact_analysis`.

**Skip planning entirely** when the diff is describable in one sentence — just do it (a critic pass is still worthwhile for risky one-liners).

**1. Plan** — dispatch `dev-pipeline:planner` (Fable) with a complete brief: the goal, the user's answered clarifications, pointers to key files/research. The planner cannot ask questions or spawn sub-agents. It writes to `~/.claude/plans/` and returns the path + summary, or a `NEEDS-CLARIFICATION` list (get answers, re-dispatch). Plans partition every phase into `### Behavior` (WHAT — observable) vs `### Implementation Notes` (HOW — the recipe); that partition is what makes step 3 work.

**2. Plan review** — the user reviews the plan (one artifact at a time — Work Cadence). Iterate until approved.

**3. Execute, phase by phase** — each role is a fresh subagent dispatch; the orchestrator carries only summaries.

Code phases (TDD):
1. `dev-pipeline:test-writer` — brief contains ONLY: objective, `### Behavior` bullets, automated success criteria, out-of-scope, docs safe for testing, paths to code under test. Never implementation notes or plan internals. It commits its test files at stage exit (the audit boundary).
2. `dev-pipeline:coverage-verifier` — classifies each behavior bullet full/partial/missing. Any `missing` → back to the test-writer with the gaps. Cap 2 test-writing cycles; escalate to the user on a 3rd.
3. Implementer (`general-purpose`) — sees the tests, the full plan, and the implementation notes. The tests are the contract: it must not weaken, skip, or delete tests to get green (test-file changes after the test-writer's commit show as diffs), and must run the phase's automated success criteria until they pass.
4. `dev-pipeline:critic` — see the gate below.

Non-code phases (docs, config, research): produce with a subagent suited to the artifact, then critic. TDD steps don't apply.

**4. Critic gate — every phase, never skipped.** The critic gets the artifacts/diff + the phase contract + a checklist + a frame-break probe, and NOT the producing agent's reasoning or self-summary (cold review). Cap 2 critic cycles per phase; a repeating root cause is a stall → escalate to the user. Phase is done when no CRITICAL/HIGH issues remain.

Building the critic brief (orchestrator's job):
- **Checklist** — derive from the phase's behavior bullets + non-functional constraints + project rules (one checkable line each; never ad-hoc). Example: "Every behavior bullet is covered by at least one failing-if-broken test", "No implicit I/O introduced (fs, net, db)".
- **Frame-break probe** — one question challenging the approach itself, grounded in a known constraint. Example: "Is this the right abstraction, given <research constraint>?"

**5. Commit per phase** — new commits at phase exit (no amend, no force-push, no `--no-verify`, no `--no-gpg-sign`).

**6. Downstream** — PRs go up draft + self-assigned.

## Input partitioning (the kernel)

| Role | Sees | Never sees |
|---|---|---|
| test-writer | objective, behavior spec, exit criteria, out-of-scope, testing-safe docs, code under test | implementation notes, plan internals, intended approach |
| coverage-verifier | behavior spec, out-of-scope, test files | implementation, plan |
| implementer | tests, full plan, implementation notes | behavior expectations not encoded in tests (tests are the contract) |
| critic | artifacts/diff, contract, checklist, frame-break probe | actor's reasoning trace or self-summary |

Over-strict isolation is safer than leaking: when unsure whether a plan bullet is WHAT or HOW, treat it as HOW and keep it from the test-writer.

## Evidence, not assertion

Every subagent must paste the raw command output it reasons from and label claims **[verified]** vs **[assumed]** (encoded in each agent definition). Orchestrator side: don't accept a bare "tests pass" — demand the output, and re-run cheap checks when in doubt.

## Critic specialist overrides

Default critic is `dev-pipeline:critic`. When a specialist is sharper, dispatch it *as* the cold reviewer with the same partitioned brief: `caveman:cavecrew-reviewer` for diff/correctness review, `code-simplifier:code-simplifier` for simplification passes. Check the session's live agent list — names drift as plugins change. For structural concerns with no dedicated reviewer (refactor blast radius, cross-codebase pattern consistency), keep the default critic but surface the evidence it checks against first — run `/dev-pipeline:impact_analysis` or an `Explore` agent during the phase. Domain skill checks (`/security-review`, `/review`) are supplemental to the critic gate, never replacements.

## Model tiering

The planner is the only Fable-pinned agent; every other pipeline agent inherits the session model (never escalating on its own). The session model itself is the **user's** runtime choice via `/model`. Binding guardrails (Claude never runs `/model` or sets `CLAUDE_CODE_SUBAGENT_MODEL`; Fable→Opus fallback) live in `~/.claude/CLAUDE.md` §Model Tiering — that section is the single source of truth for them.
