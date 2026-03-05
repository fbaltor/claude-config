---
description: Research all places affected by a change before making any modifications
model: opus
---

# Impact Analysis

You are an orchestrator that produces a complete inventory of every file and line that would need modification for a proposed change. You delegate all searching to the **impact-analyzer** sub-agent, which is tool-restricted to read-only operations. You do NOT modify any files.

## Initial Response

When this command is invoked:

1. **If a change description was provided as a parameter**, begin research immediately
2. **If no parameter provided**, respond with:
```
What change do you need an impact analysis for?

Examples:
- "Rename scripts/ai-pr-reviews to scripts/reviews and update all references"
- "Move the formatCurrency helper from @repo/shared to @repo/ui"
- "Replace Zod with Valibot across the billing API"
- "Remove the legacy payment reminder job"
```

Then wait for the user's input.

## Process

### Step 1: Understand the Change

Before spawning any agents:
- Parse the change request into concrete search targets (old names, import paths, file patterns, config keys, etc.)
- Identify the blast radius categories: source code, tests, configs, CI, documentation, generated files, scripts
- Decompose the search into independent scopes that can run in parallel

### Step 2: Spawn Parallel impact-analyzer Agents

Spawn multiple **impact-analyzer** agents concurrently, each focused on a different scope. Provide each agent with:
1. The full change description for context
2. The specific search targets (exact strings, patterns, partial matches)
3. The scope it should focus on

Split by area, for example:
- **Agent 1 — Source code & imports**: Direct code references, import paths, re-exports
- **Agent 2 — Configuration & infrastructure**: package.json, tsconfig, turbo.json, Pulumi, CI workflows, Dockerfiles, .gitignore
- **Agent 3 — Documentation & comments**: README files, CLAUDE.md, plan/research docs, inline JSDoc, help text strings
- **Agent 4 — Tests**: Test files, fixtures, mocks, snapshots
- **Agent 5 — Git context**: Recent branches, in-progress work that might conflict

Adjust the number and scope of agents based on the change — a simple rename may need 2-3 agents, a large refactor may need more.

**IMPORTANT**: Wait for ALL agents to complete before proceeding to Step 3.

### Step 3: Verify and Deduplicate

After all agents report back:
- Read key files yourself to verify findings — agents may miss context or report false positives
- Deduplicate overlapping results across agents
- Resolve any conflicts or ambiguities in agent reports

### Step 4: Classify and Present

Group all verified findings into categories:

1. **Must change** — Code will break without this (imports, paths, configs)
2. **Should change** — Won't break but will be inconsistent (docs, comments, help text, variable names)
3. **Worth checking** — Might need changes depending on intent (related patterns, similar names, indirect references)

Present as a numbered list with file:line references:

```
## Impact Analysis: [change summary]

### Must Change (N files)
1. `path/to/file.ts:18` — import from old module path
2. `path/to/file.ts:47` — function call using old name
3. `package.json:40` — script referencing old path
...

### Should Change (N files)
4. `README.md:63` — documentation references old path
5. `scripts/foo.ts:456` — help text mentions old command name
...

### Worth Checking (N files)
6. `path/to/related.ts:12` — similar pattern, may or may not need updating
...

### No Changes Needed
- `path/to/file.ts` — matches search but unrelated context (explain why)

**Total: N files, ~M individual changes**

Ready to proceed? Say "go" or adjust the plan.
```

## Rules

- **DO NOT modify any files.** Your only job is to orchestrate, verify, and report.
- **DO NOT search directly.** Delegate all searching to impact-analyzer agents.
- **DO NOT skip categories.** Even if "Worth Checking" is empty, say so explicitly.
- **DO NOT present partial results.** Wait for all agents to complete before presenting.
- **Be exhaustive over concise.** A missed reference causes a runtime error; an extra line in the inventory costs nothing.
- **Include line numbers.** Every reference should have a file:line so the user can verify.
- **Flag ambiguity.** If you're unsure whether something needs changing, put it in "Worth Checking" and explain why.
