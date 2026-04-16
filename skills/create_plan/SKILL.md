---
description: Create detailed implementation plans with thorough research and iteration
model: opus
argument-hint: "[ticket-path or description]"
disable-model-invocation: true
allowed-tools: [Write]
---

# Implementation Plan

You are tasked with creating detailed implementation plans through an interactive, iterative process. You should be skeptical, thorough, and work collaboratively with the user to produce high-quality technical specifications.

## Initial Response

When this command is invoked:

1. **Check if parameters were provided**:
   - If a file path or ticket reference was provided as a parameter, skip the default message
   - Immediately read any provided files FULLY
   - Begin the research process

2. **If no parameters provided**, respond with:
```
I'll help you create a detailed implementation plan. Let me start by understanding what we're building.

Please provide:
1. The task/ticket description (or reference to a ticket file)
2. Any relevant context, constraints, or specific requirements
3. Links to related research or previous implementations

I'll analyze this information and work with you to create a comprehensive plan.
```

Then wait for the user's input.

## Process Steps

### Step 1: Context Gathering & Initial Analysis

1. **Read all mentioned files immediately and FULLY**:
   - Ticket or task description files
   - Research documents
   - Related implementation plans
   - Any JSON/data files mentioned
   - **IMPORTANT**: Use the Read tool WITHOUT limit/offset parameters to read entire files
   - **CRITICAL**: DO NOT spawn sub-agents before reading these files yourself in the main context
   - **NEVER** read files partially - if a file is mentioned, read it completely

2. **Spawn initial research agents to gather context**:
   Before asking the user any questions, use specialized agents to research in parallel:

   - Use the **codebase-locator** agent to find all files related to the ticket/task
   - Use the **codebase-analyzer** agent to understand how the current implementation works

   These agents will:
   - Find relevant source files, configs, and tests
   - Trace data flow and key functions
   - Return detailed explanations with file:line references

3. **Read all files identified by research agents**:
   - After research agents complete, read ALL files they identified as relevant
   - Read them FULLY into the main context
   - This ensures you have complete understanding before proceeding

4. **Analyze and verify understanding**:
   - Cross-reference the ticket requirements with actual code
   - Identify any discrepancies or misunderstandings
   - Note assumptions that need verification
   - Determine true scope based on codebase reality

5. **Present informed understanding and focused questions**:
   ```
   Based on the ticket and my research of the codebase, I understand we need to [accurate summary].

   I've found that:
   - [Current implementation detail with file:line reference]
   - [Relevant pattern or constraint discovered]
   - [Potential complexity or edge case identified]

   Questions that my research couldn't answer:
   - [Specific technical question that requires human judgment]
   - [Business logic clarification]
   - [Design preference that affects implementation]
   ```

   Only ask questions that you genuinely cannot answer through code investigation.

### Step 2: Research & Discovery

After getting initial clarifications:

1. **If the user corrects any misunderstanding**:
   - DO NOT just accept the correction
   - Spawn new research agents to verify the correct information
   - Read the specific files/directories they mention
   - Only proceed once you've verified the facts yourself

2. **Spawn parallel sub-agents for comprehensive research**:
   - Create multiple Agent instances to research different aspects concurrently
   - Use the right agent for each type of research:

   **For deeper investigation:**
   - **codebase-locator** - To find more specific files (e.g., "find all files that handle [specific component]")
   - **codebase-analyzer** - To understand implementation details (e.g., "analyze how [system] works")
   - **codebase-pattern-finder** - To find similar features we can model after

   Each agent knows how to:
   - Find the right files and code patterns
   - Identify conventions and patterns to follow
   - Look for integration points and dependencies
   - Return specific file:line references
   - Find tests and examples

3. **Wait for ALL sub-agents to complete** before proceeding

4. **Present findings and design options**:
   ```
   Based on my research, here's what I found:

   **Current State:**
   - [Key discovery about existing code]
   - [Pattern or convention to follow]

   **Design Options:**
   1. [Option A] - [pros/cons]
   2. [Option B] - [pros/cons]

   **Open Questions:**
   - [Technical uncertainty]
   - [Design decision needed]

   Which approach aligns best with your vision?
   ```

### Step 3: Plan Structure Development

Once aligned on approach:

1. **Create initial plan outline**:
   ```
   Here's my proposed plan structure:

   ## Overview
   [1-2 sentence summary]

   ## Implementation Phases:
   1. [Phase name] - [what it accomplishes]
   2. [Phase name] - [what it accomplishes]
   3. [Phase name] - [what it accomplishes]

   Does this phasing make sense? Should I adjust the order or granularity?
   ```

2. **Get feedback on structure** before writing details.

3. **Apply phase-splitting discipline.** Before finalizing the phase list, check each phase against the [Splitting phases](#splitting-phases) rule. If a phase bundles independent deliverables (different types, different rollback scope, different dependency chains), propose splitting it:
   ```
   I'm considering splitting Phase N ("<name>") into:
   - Phase Na: <independent deliverable 1>
   - Phase Nb: <independent deliverable 2>

   Reasoning: <why they're independent>. Should I split?
   ```

4. **Confirm WHAT vs HOW partitioning for each phase.** Before drafting details, surface the Behavior/Implementation split as an explicit design decision — this is especially important for code phases under meta-workflow TDD isolation, but also improves reviewability for manual execution:
   ```
   For Phase N ("<name>"), let me confirm the partition:
   - **Behavior** (what the phase must deliver, observable from outside):
     - <bullet 1>
     - <bullet 2>
   - **Implementation Notes** (how to deliver it — code, SQL, file paths):
     - <approach sketch>

   Under meta-workflow TDD isolation, the test-writer sub-agent sees Behavior but NOT Implementation Notes, so any implementation detail that leaks into Behavior undermines the isolation. Does this split look right?
   ```

5. **Ask about execution mode.** Whether the plan will be executed via `/meta-workflow` (autonomous multi-phase runner) or manually phase-by-phase affects whether to include the top-level Meta-Workflow Structure section and per-phase metadata lines:
   ```
   Will this plan be executed via `/meta-workflow`, or manually phase-by-phase? If via meta-workflow, I'll include the phase contract preview table and per-phase metadata hints.
   ```

### Step 4: Detailed Plan Writing

After structure approval:

1. **Write the plan** to `~/.claude/plans/YYYY-MM-DD-description.md`
   - Format: `YYYY-MM-DD-description.md` where:
     - YYYY-MM-DD is today's date
     - description is a brief kebab-case description
   - Examples:
     - `~/.claude/plans/2025-01-08-add-pagination.md`
     - `~/.claude/plans/2025-01-08-improve-error-handling.md`
2. **Use this template structure**:

````markdown
# [Feature/Task Name] Implementation Plan

## Overview

[Brief description of what we're implementing and why]

## Current State Analysis

[What exists now, what's missing, key constraints discovered]

## Desired End State

[A Specification of the desired end state after this plan is complete, and how to verify it]

### Key Discoveries:
- [Important finding with file:line reference]
- [Pattern to follow]
- [Constraint to work within]

## What We're NOT Doing

[Explicitly list out-of-scope items to prevent scope creep]

## Implementation Approach

[High-level strategy and reasoning]

<!-- OPTIONAL: Include this section only when the plan will be executed via /meta-workflow. -->
## Meta-Workflow Structure

This plan is structured for execution via the meta-workflow skill (`~/.claude/skills/meta-workflow/SKILL.md`). Each phase has:

- **`### Behavior`** — feeds the phase contract's `behavior_spec`. Visible to the test-writer subagent under TDD isolation. Describes WHAT the phase must accomplish, not HOW.
- **`### Implementation Notes`** — feeds `docs_for_impl`. Code, SQL, file structure, dependencies. Visible only to the implementer subagent.
- **`### Success Criteria`** — split into `Automated Verification` (feeds `exit_criteria`) and `Manual Verification` (human sign-off).

### Phase contract preview

| Phase | Type   | TDD   | Critic          | Notes |
|-------|--------|-------|-----------------|-------|
| 1     | code   | true  | general-purpose | ...   |
| 2     | config | false | general-purpose | ...   |
<!-- END OPTIONAL -->

## Phase 1: [Descriptive Name]

<!-- OPTIONAL phase metadata — include when the plan may be executed via /meta-workflow. -->
**Type**: code | config | docs | mixed
**TDD**: true | false
**TDD skip reason**: <required only when TDD: false on a code-typed phase>
<!-- END OPTIONAL -->

### Overview
[What this phase accomplishes]

### Behavior

- [Observable outcome 1 — WHAT the phase must deliver, not HOW]
- [Observable outcome 2]
- [...]

### Implementation Notes

#### 1. [Component/File Group]
**File**: `path/to/file.ext`
**Changes**: [Summary of changes]

```[language]
// Specific code to add/modify
```

### Success Criteria:

#### Automated Verification:
- [ ] Migration applies cleanly
- [ ] Unit tests pass
- [ ] Type checking passes
- [ ] Linting passes
- [ ] Integration tests pass
- [ ] SQL / shell / log-grep assertions for DB or system state (prefer these over manual checks whenever mechanically expressible)

#### Manual Verification:
- [ ] Truly-manual checks only (UI render quality, notification behavior, human-perception-dependent ergonomics)
- [ ] No regressions in related features (where regression test coverage is infeasible)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: [Descriptive Name]

[Similar structure with both automated and manual success criteria...]

---

## Testing Strategy

### Unit Tests:
- [What to test]
- [Key edge cases]

### Integration Tests:
- [End-to-end scenarios]

### Manual Testing Steps:
1. [Specific step to verify feature]
2. [Another verification step]
3. [Edge case to test manually]

## Performance Considerations

[Any performance implications or optimizations needed]

## Migration Notes

[If applicable, how to handle existing data/systems]

## References

- Similar implementation: `[file:line]`
- Related research: `~/.claude/research/[relevant].md`
- Meta-workflow skill (if applicable): `~/.claude/skills/meta-workflow/SKILL.md`
````

### Step 5: Review

1. **Present the draft plan location**:
   ```
   I've created the initial implementation plan at:
   `~/.claude/plans/YYYY-MM-DD-description.md`

   Please review it and let me know:
   - Are the phases properly scoped?
   - Are the success criteria specific enough?
   - Are Behavior bullets free of implementation leakage?
   - Any technical details that need adjustment?
   - Missing edge cases or considerations?
   ```

2. **Iterate based on feedback** - be ready to:
   - Add missing phases
   - Adjust technical approach
   - Clarify success criteria (both automated and manual)
   - Re-partition Behavior vs Implementation Notes if leakage is flagged
   - Add/remove scope items

3. **Continue refining** until the user is satisfied

## Important Guidelines

1. **Be Skeptical**:
   - Question vague requirements
   - Identify potential issues early
   - Ask "why" and "what about"
   - Don't assume - verify with code

2. **Be Interactive**:
   - Don't write the full plan in one shot
   - Get buy-in at each major step
   - Allow course corrections
   - Work collaboratively

3. **Be Thorough**:
   - Read all context files COMPLETELY before planning
   - Research actual code patterns using parallel sub-agents
   - Include specific file paths and line numbers
   - Write measurable success criteria with clear automated vs manual distinction
   - **Separate WHAT (observable behavior) from HOW (implementation detail) per phase.** The `### Behavior` section is the contract; `### Implementation Notes` is the recipe. Do not mix.

4. **Be Practical**:
   - Focus on incremental, testable changes
   - Consider migration and rollback
   - Think about edge cases
   - Include "what we're NOT doing"

5. **No Open Questions in Final Plan**:
   - If you encounter open questions during planning, STOP
   - Research or ask for clarification immediately
   - Do NOT write the plan with unresolved questions
   - The implementation plan must be complete and actionable
   - Every decision must be made before finalizing the plan

## Success Criteria Guidelines

**Always separate success criteria into two categories:**

1. **Automated Verification** (can be run by execution agents):
   - Commands that can be run: `pnpm build`, `pnpm lint`, etc.
   - Specific files that should exist
   - Code compilation/type checking
   - Automated test suites
   - **SQL / shell / log-grep assertions** that capture DB or system state (`psql -c "SELECT ..."`, `grep -q ...`, `test -f ...`)

2. **Manual Verification** (requires human testing):
   - UI/UX render quality
   - Performance under real conditions
   - Edge cases that are hard to automate
   - User acceptance criteria

**Preference rule:** Before adding an item to Manual Verification, ask whether it can be expressed as an automated assertion. "Conversation appears in UI with correct timestamps" is often really "`SELECT MIN(created_at), MAX(created_at) FROM messages WHERE conversation_id = X` matches the expected range." Reserve Manual Verification for checks that genuinely require human judgment (visual layout, subjective UX, notification-bell behavior).

**Format example:**
```markdown
### Success Criteria:

#### Automated Verification:
- [ ] Database migration runs successfully
- [ ] All unit tests pass
- [ ] No linting errors: `pnpm lint`
- [ ] Type checking passes: `pnpm check-types`
- [ ] `psql $DB_URL -c "SELECT COUNT(*) FROM new_table"` returns expected count after seed

#### Manual Verification:
- [ ] New feature appears correctly in the UI
- [ ] Performance is acceptable with 1000+ items
- [ ] Error messages are user-friendly
- [ ] Feature works correctly on mobile devices
```

## Meta-Workflow Alignment

Plans created by this skill should be structured so they can optionally be executed via the meta-workflow skill (`~/.claude/skills/meta-workflow/SKILL.md`) — a multi-phase autonomous runner with TDD isolation and adversarial-critic gating. The discipline below also improves readability for manual execution, so apply it regardless of intended execution mode.

### WHAT vs HOW partitioning

The `### Behavior` section of each phase is the contract — what the phase must deliver, observable from outside. The `### Implementation Notes` section is the recipe — how to deliver it, with code, SQL, file paths, and dependencies.

Under meta-workflow TDD isolation, the test-writer sub-agent sees `Behavior` but NOT `Implementation Notes`. Implementation detail leaking into `Behavior` undermines the isolation: the test-writer ends up seeing internals it should not, and the tests it writes are biased toward a specific implementation rather than the observable contract.

Good `Behavior` bullet (stays abstract):
> `parseAndStore(prisma, config)` returns `{importId, messageCount}`. Calling with a duplicate `(fileHash, accountId, inboxId)` returns the existing `importId` without reparsing or writing new rows.

Bad `Behavior` bullet (leaks HOW):
> Use `prisma.whatsAppImport.findFirst` to check for duplicates before calling `parseChat`.

If in doubt, err toward quarantining content in `Implementation Notes`. Meta-workflow treats the `### Behavior` section as authoritative — anything outside it is invisible to the test-writer.

### Splitting phases

Split a single proposed phase into sub-phases (e.g., `Phase 1a`, `Phase 1b`) when ANY of these apply:
- Deliverables are independent (different artifact types, different rollback scope)
- Dependencies differ (one can land before the other without blocking)
- A reviewer would want to critique them separately
- Rollback of one should not force rollback of the other

Rule of thumb: *"Would I want to critique these together, or separately?"* If separately, split. If the answer is ambiguous, lean toward splitting — smaller phases improve critic signal and resumability under meta-workflow.

### Converting manual gates to automated

Prefer SQL assertions, shell commands, or log greps over "UI shows X" / "operator verifies Y" whenever mechanically checkable:

| Weak manual gate                          | Stronger automated proxy                                                     |
|-------------------------------------------|------------------------------------------------------------------------------|
| "Conversation appears in UI"              | `psql -c "SELECT 1 FROM conversations WHERE id=$ID"` returns one row         |
| "No duplicate messages after re-run"      | `SELECT COUNT(*) FROM messages WHERE conversation_id=$ID` equals pre-rerun   |
| "No errors in logs during operation"      | `grep -q "ERROR" logfile && exit 1 \|\| exit 0`                              |
| "Migration produced expected tables"      | `SELECT tablename FROM pg_tables WHERE tablename IN (...)` returns all names |
| "Idempotency index exists"                | `SELECT indexname FROM pg_indexes WHERE indexname='...'` returns one row     |

Reserve `Manual Verification` for checks that genuinely cannot be mechanized: UI render quality, notification-bell behavior, human-perception-dependent ergonomics, human-agent interaction workflows.

### Folding validation into the producing phase

If a downstream "validation" phase's assertions are all SQL/shell checks over artifacts the producing phase already completed, fold those assertions into the producing phase's `Exit Criteria (automated)`. Reserve separate validation phases for true manual sign-off.

Example:
- A "Phase N: End-to-End Validation" whose every step is "run command; assert state" belongs in Phase N-1's automated exit criteria.
- A "Phase N: Manual Sign-Off" that validates UI rendering, notification behavior, or human-agent workflow stands on its own as a manual-only phase.

Under meta-workflow, manual-only phases are escalated via `AskUserQuestion` rather than auto-run by a subagent.

### Phase metadata

Each phase may include optional metadata lines immediately after the phase heading:

- `**Type**: code | config | docs | mixed` — feeds the phase contract's `type` field. `code` = produces runnable logic. `config` = schema, infra, env wiring. `docs` = documentation-only. `mixed` = a combination.
- `**TDD**: true | false` — overrides the default (`code` → `true`, others → `false`).
- `**TDD skip reason**: ...` — required when `TDD: false` on a `code`-typed phase. Explains why the phase has no behavior to test in isolation (e.g., schema-only, exercised by a downstream phase).

These are plain markdown bold lines — readable for humans; parseable by meta-workflow's contract-derivation heuristic. Omit entirely for plans not destined for meta-workflow.

### Top-level "Meta-Workflow Structure" section

Include the `## Meta-Workflow Structure` section (with phase contract preview table) in the plan ONLY when the user has indicated the plan will be executed via `/meta-workflow`. It adds noise to plans destined for manual execution.

When present, it should contain:
- A short paragraph explaining the `Behavior` / `Implementation Notes` / `Success Criteria` structure
- A table with columns: `Phase | Type | TDD | Critic | Notes` — one row per phase, matching the per-phase metadata

### What stays unchanged

Meta-workflow alignment is additive. The following remain unchanged regardless:

- Iterative Q&A with the user (skeptical stance, clarification loops, verification-before-planning)
- Sub-agent research spawning
- File:line references in Key Discoveries and References
- Specific code blocks in Implementation Notes
- "No open questions in final plan" rule
- "What We're NOT Doing" section and scope discipline

## Common Patterns

### For Database Changes:
- Start with schema/migration
- Add store methods
- Update business logic
- Expose via API
- Update clients

### For New Features:
- Research existing patterns first
- Start with data model
- Build backend logic
- Add API endpoints
- Implement UI last

### For Refactoring:
- Document current behavior
- Plan incremental changes
- Maintain backwards compatibility
- Include migration strategy

## Sub-Agent Spawning Best Practices

When spawning research sub-agents:

1. **Spawn multiple agents in parallel** for efficiency
2. **Each agent should be focused** on a specific area
3. **Provide detailed instructions** including:
   - Exactly what to search for
   - Which directories to focus on
   - What information to extract
   - Expected output format
4. **Be EXTREMELY specific about directories**:
   - Include the full path context in your prompts
5. **Specify read-only tools** to use
6. **Request specific file:line references** in responses
7. **Wait for all agents to complete** before synthesizing
8. **Verify sub-agent results**:
   - If a sub-agent returns unexpected results, spawn follow-up agents
   - Cross-check findings against the actual codebase
   - Don't accept results that seem incorrect

## Example Interaction Flow

```
User: /create_plan
Assistant: I'll help you create a detailed implementation plan...

User: We need to add pagination to the API endpoints.
Assistant: Let me read any related files first...

[Reads files fully]

Based on the task, I understand we need to add cursor-based pagination to the listing endpoints. Before I start planning, I have some questions...

[Interactive process continues...]
```
