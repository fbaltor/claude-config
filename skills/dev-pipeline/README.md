# dev-pipeline

The dev workflow as one versioned unit — a skills-directory plugin (`dev-pipeline@skills-dir`, auto-loaded from this folder, no install step). This is the discipline kernel of the retired `meta-workflow` skill, promoted to first-class agents; the orchestration shell (status.yaml, contract-confirmation ceremony, resume protocol) was dropped after usage evidence showed ~30 plans produced vs 1 shell run — the agents follow the discipline without the machinery.

## Components

| Component | Invoke as | Role |
|---|---|---|
| `agents/planner.md` | `dev-pipeline:planner` (Fable) | Complete, self-contained implementation plan from a brief |
| `agents/test-writer.md` | `dev-pipeline:test-writer` | Failing test suite from a behavior spec, before implementation |
| `agents/coverage-verifier.md` | `dev-pipeline:coverage-verifier` | Read-only full/partial/missing audit of test coverage |
| `agents/implementer.md` | `dev-pipeline:implementer` | Production code that turns the committed tests green, without touching them |
| `agents/critic.md` | `dev-pipeline:critic` | Adversarial cold review gating completion |
| `skills/research_codebase/` | `/dev-pipeline:research_codebase` | Parallel-subagent codebase investigation → research doc |
| `skills/impact_analysis/` | `/dev-pipeline:impact_analysis` | Read-only blast-radius inventory for a proposed change |

Editing any file here requires `/reload-plugins` or a new session to take effect.

## The pipeline

**0. Intake & clarify** — orchestrator. Ask the user clarifying questions (`AskUserQuestion`); gather context with `Explore` / `cavecrew-investigator`; for unfamiliar territory run `/dev-pipeline:research_codebase`, for risky refactors `/dev-pipeline:impact_analysis`.

**Skip planning entirely** when the diff is describable in one sentence — just do it (a critic pass is still worthwhile for risky one-liners).

**1. Plan** — dispatch `dev-pipeline:planner` (Fable) with a complete brief: the goal, the user's answered clarifications, pointers to key files/research. The planner cannot ask questions or spawn sub-agents. It writes to `~/.claude/plans/` and returns the path + summary, or a `NEEDS-CLARIFICATION` list (get answers, re-dispatch). Plans partition every phase into `### Behavior` (WHAT — observable) vs `### Implementation Notes` (HOW — the recipe); that partition is what makes step 3 work. Each code phase also carries `### Test Rigor` (`light` | `standard` | `exhaustive`) with a one-line justification — see the tier table below; the user ratifies or bumps it during plan review.

**2. Plan review** — the user reviews the plan (one artifact at a time — Work Cadence). Iterate until approved.

**3. Execute, phase by phase** — each role is a fresh subagent dispatch; the orchestrator carries only summaries.

Code phases (TDD):
1. `dev-pipeline:test-writer` — brief contains ONLY: objective, `### Behavior` bullets, the phase's `### Test Rigor` tier, automated success criteria, out-of-scope, docs safe for testing, paths to code under test. Never implementation notes or plan internals. It commits its test files at stage exit (the audit boundary).
2. `dev-pipeline:coverage-verifier` — classifies each behavior bullet full/partial/missing against the phase's rigor tier (its bar for "missed edge case" is tier-relative). Any `missing` → back to the test-writer with the gaps. Cap 2 test-writing cycles; escalate to the user on a 3rd.
3. `dev-pipeline:implementer` — sees the tests, the full plan, and the implementation notes. The tests are the contract: it must not weaken, skip, or delete tests to get green, and must run the phase's automated success criteria until they pass. **Dispatch it; do not implement inline.** An orchestrator that has read the tests is free to reshape them and accumulates implementation detail it is supposed to carry only as summaries — this stage exists to make that structurally impossible. A test the implementer believes is wrong comes back as a report, not an edit; route it to the test-writer. Its report must include `git diff --name-only <test-writer-sha>..HEAD` filtered to the locked set (every file the test-writer's stage-exit commit touched — specs *and* their fixtures/mocks/snapshots), proving empty.
4. `dev-pipeline:critic` — see the gate below.

Non-code phases (docs, config, research): produce with a subagent suited to the artifact, then critic. TDD steps don't apply.

**4. Critic gate — every phase, never skipped.** The critic gets the artifacts/diff + the phase contract + a checklist + a frame-break probe, and NOT the producing agent's reasoning or self-summary (cold review). Cap 2 critic cycles per phase; a repeating root cause is a stall → escalate to the user. Phase is done when no CRITICAL/HIGH issues remain.

Building the critic brief (orchestrator's job):
- **Checklist** — derive from the phase's behavior bullets + non-functional constraints + project rules (one checkable line each; never ad-hoc). Example: "Every behavior bullet is covered by at least one failing-if-broken test", "No implicit I/O introduced (fs, net, db)".
- **Provenance line — mandatory on every code phase, never omitted:** "The production code came from a dispatched `dev-pipeline:implementer` report carrying its pasted, empty test-diff proof — not from inline orchestrator edits." Give the critic the implementer's stage-exit sha as a named input; if there is no implementer report to point at, that is a FAIL, not an UNCLEAR. This line exists because the critic is the only role that has been dispatched on every phase in practice — putting the anti-absorption check anywhere else means it is missing in exactly the case it is meant to catch.
- **Tier line — every code phase:** "The suite's depth matches the phase's `### Test Rigor` tier: every behavior bullet has a failing-if-broken test, and at `light`/`standard` the suite does not go materially deeper than the tier allows." An oversized suite is a FAIL, not diligence — without this line nothing in the pipeline can ever say "too many tests."
- **Frame-break probe** — one question challenging the approach itself, grounded in a known constraint. Example: "Is this the right abstraction, given <research constraint>?"

**5. Commit per phase** — new commits at phase exit (no amend, no force-push, no `--no-verify`, no `--no-gpg-sign`).

**6. Downstream** — PRs go up draft + self-assigned.

## Test rigor tiers (per code phase)

| Tier | Suite shape |
|---|---|
| `light` | One test per behavior bullet — happy path + only bullet-named error paths; no boundary sweeps, taxonomies, purity checks |
| `standard` | `light` + boundary triplet (n−1/n/n+1) per named limit + one representative per named invalid-input class |
| `exhaustive` | Systematic edge-case analysis — input-class taxonomies, error precedence, purity/non-mutation. Reserve for phases the plan justifies |

The floor never moves: every behavior bullet has ≥1 failing-if-broken test at every tier — the tier changes edge-case *depth*, never bullet *coverage*. The planner proposes the tier per phase (criteria in planner.md: blast radius, logic density, sole-verification-layer, contract stability); the user ratifies at plan review; the orchestrator threads it verbatim into the test-writer, coverage-verifier, and critic briefs. For code work without a plan, the orchestrator sets it (default `light`) or asks. The tier is a contract input: the test-writer never chooses its own tier, and the implementer has no say in it — tests are the contract at every tier. Density rules (`it.each` folding, comments on fixtures not tests) are unconditional in test-writer.md, independent of tier.

## Input partitioning (the kernel)

| Role | Sees | Never sees |
|---|---|---|
| test-writer | objective, behavior spec, rigor tier, exit criteria, out-of-scope, testing-safe docs, code under test | implementation notes, plan internals, intended approach |
| coverage-verifier | behavior spec, rigor tier, out-of-scope, test files | implementation, plan |
| implementer | tests, full plan (incl. `### Behavior`), implementation notes, test-writer stage-exit sha | the test-writer's reasoning trace; any expectation list positioned as overriding the tests (tests are the contract) |
| critic | artifacts/diff, contract, checklist, frame-break probe | actor's reasoning trace or self-summary |

Over-strict isolation is safer than leaking: when unsure whether a plan bullet is WHAT or HOW, treat it as HOW and keep it from the test-writer.

## Evidence, not assertion

Every subagent must paste the raw command output it reasons from and label claims **[verified]** vs **[assumed]** (encoded in each agent definition). Orchestrator side: don't accept a bare "tests pass" — demand the output, and re-run cheap checks when in doubt.

## Critic specialist overrides

Default critic is `dev-pipeline:critic`. When a specialist is sharper, dispatch it *as* the cold reviewer with the same partitioned brief: `caveman:cavecrew-reviewer` for diff/correctness review, `code-simplifier:code-simplifier` for simplification passes. Check the session's live agent list — names drift as plugins change. For structural concerns with no dedicated reviewer (refactor blast radius, cross-codebase pattern consistency), keep the default critic but surface the evidence it checks against first — run `/dev-pipeline:impact_analysis` or an `Explore` agent during the phase. Domain skill checks (`/security-review`, `/review`) are supplemental to the critic gate, never replacements.

## Model + effort tiering (per role)

Each role declares its own model and effort, because a pipeline that only pins the planner *up* leaves the cheapest roles running on the priciest model. Frontmatter `effort` overrides the session effort level; `model: inherit` follows the session.

| Role | `model` | `effort` | Why |
|---|---|---|---|
| planner | `fable` | `high` | The high-value reasoning role — but `xhigh` was 90% thinking and drove plan bloat (727-line plan for a 456-line module) |
| test-writer | `inherit` | `medium` | Authors the contract; expectations are error-prone (see red-phase limits) so not lowered, but does not need max depth |
| coverage-verifier | **`sonnet`** | `medium` | Bounded read-only classification against a spec — the one role pinned *down*. Watch it: at `xhigh` it caught a subtle "any ≥3-char string passes" gap |
| implementer | `inherit` | `medium` | Contract is external (committed tests), so its reasoning burden is bounded |
| critic | `inherit` | `high` | Adversarial rigour is the whole point; found the real defects. Bump to `xhigh` if quality visibly drops |

Non-code phases (docs, config) are dispatched with an explicit cheap model — downgrading a *producing* role is fine.

**Never downgrade a checking role.** Passing a `model` override below the session model to the critic (or whatever agent is dispatched *as* the cold reviewer) is prohibited; on a transient 429/529 retry at the same tier or resume via `SendMessage`. The critic self-reports `model`/`effort` in `review_context` and flags `tier_warning` if it was dispatched below tier, so a weakened gate shows up in the report. Rationale and the measured evidence: `~/.claude/research/2026-07-29-dev-pipeline-throughput-audit.md`.

The session model and session effort are the **user's** runtime choices (`/model`, `/effort`). Binding guardrails (Claude never runs `/model`, never sets `CLAUDE_CODE_SUBAGENT_MODEL` or `CLAUDE_CODE_EFFORT_LEVEL`; Fable→Opus fallback; the tiering floor) live in `~/.claude/CLAUDE.md` §Model Tiering — that section is the single source of truth for them.
