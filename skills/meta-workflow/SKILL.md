---
description: Run a multi-phase task autonomously — normalize plan into phase contracts, execute each phase in a fresh subagent, enforce TDD isolation on code phases, gate every phase with an adversarial critic, checkpoint state to disk for resumability.
model: opus
argument-hint: "<plan-path> [--auto|--manual] [--research <path>]"
disable-model-invocation: true
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash, Agent, AskUserQuestion]
---

# Meta-Workflow: Autonomous Multi-Phase Tasks

Run an end-to-end multi-phase task without phase-by-phase babysitting. Each phase runs in a fresh `Agent` dispatch (context isolation), inputs are partitioned for TDD isolation, and an adversarial critic gates every phase exit.

## Inputs

```
/meta-workflow <plan-path> [--auto|--manual] [--research <path>]
```

- **plan-path** — a plan doc (typically from `/create_plan`) with numbered phases.
- **--research <path>** — a research doc (typically from `/research_codebase`). If omitted, use the first reference found in the plan.
- **--auto** (default) — chain all phases until done or escalation.
- **--manual** — pause after each phase's critic exits; await user go.

## Phase contract schema

Derived from the plan doc, confirmed once per phase, stored in `<plan-path>.status.yaml` under `phases[]`.

```yaml
- id: 02-mapper
  type: code                        # code | docs | research | config | mixed
  tdd: true                         # defaults true for type=code, false otherwise
  objective: Map parser output onto Chatwoot message model.
  behavior_spec:                    # WHAT — visible to test-writer only
    - Handles text/media/system message types
    - Converts timestamps (seconds → ISO-8601)
    - Returns error value on malformed input; never throws
  inputs:
    code: [packages/chatwoot-import/src/parser/types.ts]
    docs_for_testing: [research.md#message-model]     # test-writer may read
    docs_for_impl:    [plan.md#phase-02-impl-notes]   # implementer only
  exit_criteria:
    - pnpm --filter @repo/chatwoot-import check-types
    - pnpm --filter @repo/chatwoot-import test
    - zero new runtime deps
  out_of_scope: [attachment upload, deduplication]
  critic:
    subagent_type: general-purpose
    checklist:
      - Every behavior_spec bullet is covered by at least one failing-if-broken test
      - No implicit I/O introduced (fs, net, db)
      - Downstream phase inputs honored (see plan.md#phase-03-inputs)
    frame_break_probe: Is this the right abstraction, given <research constraint>?
```

Rules:
- `type: code` → `tdd: true` by default. Override with `tdd: false` + required `tdd_skip_reason`.
- `behavior_spec` must not contain implementation detail. If unsure, it belongs in `docs_for_impl`.

## Entry protocol (every invocation)

1. Read `<plan-path>` and `<plan-path>.status.yaml` (create the status file if missing).
2. **Batch contract derivation.** For every phase without a confirmed contract, derive one from the plan prose (see [Contract derivation](#contract-derivation-heuristic)). Save all derived contracts to status with `contract_confirmed: false`.
3. **Batch contract review (one pass per task).** Walk through every unconfirmed contract in a single pass, using sequential `AskUserQuestion` calls — one per phase — to confirm `behavior_spec` and `out_of_scope`. After this pass, `--auto` mode runs uninterrupted; `--manual` mode additionally pauses between phases after each critic exit.
4. Find the first phase with `status != done`. Jump to its in-progress stage.

## Contract derivation (heuristic)

From each phase section in the plan doc:

| Plan content                                                     | Maps to                          |
|------------------------------------------------------------------|----------------------------------|
| Phase heading + opening paragraph                                | `id` (slugified), `objective`    |
| Bullets under `### Behavior` (or plainly WHAT-style bullets)     | `behavior_spec`                  |
| Prose / code snippets describing HOW / approach                  | `docs_for_impl` (by plan anchor) |
| Bullets under `### Success Criteria` or `Automated Verification` | `exit_criteria`                  |
| "What We're NOT Doing" section (global or per-phase)             | `out_of_scope`                   |
| `behavior_spec` + non-functional constraints + project rules     | `critic.checklist` (generated)   |

Ambiguous bullets default to `docs_for_impl` and surface in the confirmation step. Err toward quarantining content away from the test-writer — over-strict isolation is safer than leaking implementation into tests.

## Phase execution

**Every phase is one `Agent` dispatch.** The orchestrator's context grows by only a summary per phase. Subagents own the heavy reads.

### Code phases (`tdd: true`)

1. **Test authoring** — dispatch `general-purpose` subagent.
   - Sees: `objective`, `behavior_spec`, `exit_criteria`, `out_of_scope`, `inputs.docs_for_testing`, `inputs.code`.
   - **Forbidden**: `inputs.docs_for_impl`, plan.md sections other than the phase header.
   - Commits test files. Status → `stages.test-writing: done`.
2. **Coverage verification** — dispatch a read-only subagent.
   - For each `behavior_spec` bullet, classify as `full | partial | missing`.
   - Any `missing` → loop to step 1 with gaps. Cap 2 cycles; escalate on 3rd.
3. **Implementation** — dispatch `general-purpose` subagent.
   - Sees: tests, plan.md in full, `inputs.docs_for_impl`.
   - **Forbidden**: behavior detail not already encoded in tests (tests are the contract).
   - Runs `exit_criteria` commands until green.
4. **Critique** — see below.

### Non-code phases

1. **Produce** — dispatch a subagent appropriate to `type`.
2. **Critique** — see below.

## Critic protocol

Run after every phase. **Never skip**, regardless of phase type.

Dispatch `critic.subagent_type` (default `general-purpose`) with this prompt:

```
You are the critic for phase <id>. Your only job is to find problems.

Inputs:
- Phase contract: <contract block>
- Phase output (cold — no actor reasoning trace): <artifact paths>
- Evaluation checklist: <critic.checklist bullets>
- Frame-break probe: <critic.frame_break_probe>

Rules:
- Do not summarize what was done correctly. Do not praise.
- For every checklist item, state PASS / FAIL / UNCLEAR with file:line evidence.
- Question premises, not just execution. If the approach is wrong for the objective, say so.
- If you find no HIGH/CRITICAL issue, explain what you looked for and why it passed.

Output (strict YAML):
issues:
  - { id, severity: CRITICAL|HIGH|MEDIUM|LOW, summary, evidence, suggested_fix }
remaining_actionable_issues: [ids]   # or NONE
frame_concerns: [bullets]            # or NONE
```

After critic returns:
- Write full report to `<plan-path>/phase-<id>-critic-<iter>.md`.
- If `remaining_actionable_issues == NONE` **or** no HIGH/CRITICAL remain → phase `done`.
- Else → dispatch implementer with issue list; loop. **Cap 2 critic cycles per phase.**
- **Stall detection:** same issue id across 2 consecutive cycles → stop; `AskUserQuestion` escalates.

### Choosing `critic.subagent_type`

Default is `general-purpose`. Override per-phase in the contract when a specialist is sharper:

| Phase concern                      | Recommended override      |
|------------------------------------|---------------------------|
| Refactor / rename / move           | `impact-analyzer`         |
| Cross-codebase pattern consistency | `codebase-analyzer`       |
| Finding similar existing patterns  | `codebase-pattern-finder` |
| Code simplification opportunities  | `code-simplifier`         |
| General code (default)             | `general-purpose`         |

Override applies only to that phase's critique; do not set it globally. For domain review that lives in a skill (`/security-review`, `/review`), invoke the skill via the `Skill` tool after the critic — the critic is the structural gate; skill checks are supplemental.

## Status file

Path: `<plan-path>.status.yaml`. Write on **every** stage transition (not only phase end) — a timed-out subagent is then resumable from its last stage.

```yaml
task: <task-id>
plan_doc: <path>
research_doc: <path>
phases:
  - id: <phase-id>
    status: not-started | test-writing | coverage-verifying | implementing | critiquing | done
    stages: { test-writing: done, coverage-verifying: done, ... }
    critic_state:
      iteration: 1
      pending_issues: [{ id, severity, summary }]
      resolved_issues: [{ id, fixed_in_commit }]
    artifacts: { tests: <path>, impl: <path> }
```

Commit at every phase exit. Message format:

```
[<TICKET>] phase <id>: <stage summary> (critic iter <N>)
```

## Resume protocol

On re-invocation after `/clear`, crash, or interruption:

1. Read the status file; find the first phase with `status != done`.
2. Resume from its current in-progress stage.
3. **Do not re-read** completed phases' artifacts. Trust the commits + status.

## Mode behavior

- `--auto`: after a phase reaches `done`, orchestrator dispatches the next phase immediately.
- `--manual`: after each phase reaches `done`, orchestrator writes a one-paragraph summary and uses `AskUserQuestion` with options `continue / stop / follow-up`.

## Permissions

**Always** (no prompt):
- Read plan / research / source / test files.
- Dispatch subagents for every phase and every role.
- Write status file, critic reports, test files, implementation files.
- Commit phase artifacts with the structured message above.

**Ask first** (via `AskUserQuestion`):
- Confirm derived `behavior_spec` + `out_of_scope` before first dispatch of each phase.
- Stall escalation (same issue id across 2 critic cycles).
- Exit criteria that reach outside the repo (deploys, external API writes, DB migration against a shared env).

**Never:**
- Skip the critic for any phase.
- Let the test-writer see `docs_for_impl` or any plan content beyond the phase header.
- Amend commits — always create new ones at phase exit.
- Force-push. Delete or reorder phases in the plan.
- `--no-verify` or `--no-gpg-sign` on commits.

## Compatibility

Sits above — does not replace — project `AGENTS.md` / `CLAUDE.md`. On conflict, project rules win for project-specific concerns (env vars, deploy commands, code style); this skill wins for the meta-workflow (phase protocol, critic loop, status format, TDD isolation).

## Dispatch prompts

Role-specific prompt templates live alongside this file under `prompts/`:

- `prompts/critic.md` — phase-exit critique (anti-sycophancy, severity-tagged output)
- `prompts/test-writer.md` — TDD stage 1 (input-partitioned, behavior_spec as contract)
- `prompts/coverage-verifier.md` — TDD stage 2 (read-only audit, full/partial/missing)

At dispatch time, the orchestrator reads the relevant template, substitutes phase context into `{{placeholders}}`, and passes the result as the subagent's initial prompt. This keeps role contracts explicit and the main SKILL.md lean.

## Related skills

- `/research_codebase` — produces the research doc. Invoke before this skill.
- `/create_plan` — produces the plan doc. Invoke before this skill.
- `/impact_analysis` — dispatch on-demand within a phase for refactor blast radius.
- `/implement_plan` — human-gated sibling for simpler tasks; not called by this skill.
- `/triage-reviews` — after the PR is opened; outside this skill's scope.

## Orchestrator pseudocode (reference)

```
read plan, status
for phase in phases:
    if phase.status == "done": continue
    if not phase.contract_confirmed:
        derive_contract_from_plan(phase)
        ask_confirm(behavior_spec, out_of_scope)
        write_status()
    dispatch_phase_subagent(phase)          # single Agent call, fresh context
    summary, status_delta = await result
    write_status(); commit_artifacts(phase)
    if mode == "--manual":
        ask_continue(summary)
```
