---
description: Fetch all PR review comments (human + bot), analyze them against the source code, and classify as false positive / minor / major
model: opus
argument-hint: "[--wait] [--pr <number>] [--repo owner/repo]"
allowed-tools: [Read, Bash, Grep, Glob]
---

# Triage PR Reviews

Fetch all review comments from a GitHub PR via the review scripts, read the relevant source code, and classify each comment as **false positive**, **minor**, or **major**. Outdated comments are presented separately.

## Script invocation convention

All review scripts are invoked via `npm run` from the scripts directory. This uses the local `tsx` from `node_modules/.bin/` instead of relying on a global install. Pass script arguments after `--`:

```bash
npm --prefix ~/.claude/scripts/reviews run <script-name> -- <args>
```

## Step 1 — Resolve arguments

Parse `$ARGUMENTS` for:

- `--pr <number>` — PR number (if omitted, the script auto-detects from current branch)
- `--repo owner/repo` — target repository (default: `Jumpstart-Immigration/jumpstart`)
- `--wait` — wait for bot reviews to complete before fetching

## Step 2 — Fetch review data

### Without `--wait`:

```bash
npm --prefix ~/.claude/scripts/reviews run fetch-reviews -- --pr PR --repo OWNER/REPO
```

### With `--wait`:

Run the fetch command with `--wait` using the Bash tool with `run_in_background: true`:

```bash
npm --prefix ~/.claude/scripts/reviews run fetch-reviews -- --wait --pr PR --repo OWNER/REPO
```

Tell the user: "Waiting for bot reviews to complete. I'll proceed with triage when ready."
When the background process completes, continue with the next step.

**IMPORTANT**: Do NOT guess, fabricate, or assume what the script output will look like. Wait for the background task to actually complete, then read its real output.

### Read the YAML output

The script prints parseable output paths to stdout in the format `yaml: /absolute/path/to/file.yaml`. After the background task completes, find the line starting with `yaml:` in the task output and read that exact file path with the Read tool. Do NOT invent file paths or assume the output directory — always extract the path from the actual script output.

## Step 3 — Filter to actionable comments

The YAML provides structured data per comment:
- `comments[].type` — `"review_summary" | "inline" | "general"`
- `comments[].file` / `comments[].line` / `comments[].line_range` — source location
- `comments[].is_outdated` — whether the diff context has changed
- `comments[].severity` / `comments[].category` — bot-parsed severity (signal for classification)
- `reviewers[].type` — `"bot" | "human"`

Partition comments:
- **Resolved**: already filtered out by the script
- **Outdated**: `is_outdated: true` → separate section (presented but not classified)
- **PR author**: skip comments by the PR author (self-replies, not review feedback; check `pr.author` field)
- **Empty review bodies**: skip `review_summary` comments with trivial/empty bodies
- **Actionable**: everything else → classify

## Step 4 — Read source code

For each actionable inline comment, read the referenced source file.

1. Collect all unique file paths from actionable inline comments.
2. Read each file **once** with the Read tool (even if multiple comments reference it).
3. Make **parallel** Read calls — batch all file reads into a single response.
4. If a file no longer exists, note the comment may be moot.

## Step 5 — Classify each comment

For each actionable comment, consider **both** the reviewer's text **and** the actual source code:

| Classification      | Criteria |
| ------------------- | -------- |
| **False positive**  | The concern is factually incorrect, already addressed in the current code, based on a misunderstanding, or not applicable to this context |
| **Minor**           | Style/naming suggestions, small readability improvements, documentation tweaks, nitpicks — things that don't affect correctness, security, or performance |
| **Major**           | Bugs, security vulnerabilities, logic errors, missing error handling, data loss risks, significant performance problems, architectural concerns — real impact |

Guidelines:

- When a bot provides pre-parsed `severity`/`category`, use as a **signal** but verify independently against the code.
- If a review submission body raises multiple distinct issues, break them into separate classified items.
- If the thread discussion shows the issue was acknowledged but not yet fixed, still classify based on severity.
- When uncertain, lean toward the higher severity classification.

## Step 6 — Present triage

### ID format

Each issue gets a unique ID: `<reviewer>/<severity>-<n>`, where:
- **reviewer** — abbreviated: `cp` (Copilot), `cr` (CodeRabbit), `va` (Vercel Agent), or first 2–3 letters of a human reviewer's GitHub username
- **severity** — `crit`, `high`, `med`, `min`, `fp` (false positive)
- **n** — sequential per reviewer+severity pair (e.g., `cp/med-1`, `cp/med-2`)

### Output format

```
## PR Review Triage

**PR #N**: title
**Reviewers**: @alice (al), @copilot[bot] (cp), @coderabbitai[bot] (cr)
**Stats**: X high | Y medium | Z minor | W false positives | V outdated | U resolved (skipped)

---

### Issues

**cp/min-1** 🟡 **Short description** · `file/path.ts:15` · [link](comment-url)
   Reviewer's comment (first ~3 lines).
   → _Assessment: brief note._

**cp/med-1** 🟠 **Short description** · `file/path.ts:42` · [link](comment-url)
   Reviewer's comment (first ~3 lines).
   → _Assessment: why this matters and what needs to change._

**cr/high-1** 🔴 **Short description** · `file/path.ts:88` · [link](comment-url)
   Reviewer's comment (first ~3 lines).
   → _Assessment: why this is high severity._

**cp/fp-1** ⚪ **Short description** · `file/path.ts:20` · [link](comment-url)
   Reviewer's comment.
   → _Assessment: why this is a false positive._

### Outdated

_These comments are on code that has changed since the review. They may or may not still be relevant._

**cr/med-2** 🟠 **Short description** · `file/path.ts:20` · [link](comment-url) · `[outdated]`
   Reviewer's comment.

---

## Summary

| ID         | Severity    | Issue              | File                |
|------------|-------------|--------------------|---------------------|
| cr/high-1  | 🔴 High     | Short description  | `file/path.ts:88`   |
| cp/med-1   | 🟠 Medium   | Short description  | `file/path.ts:42`   |
| cp/min-1   | 🟡 Minor    | Short description  | `file/path.ts:15`   |
| cp/fp-1    | ⚪ False pos | Short description  | `file/path.ts:20`   |

## Suggested action

Fix **cr/high-1** first — reason. Then **cp/med-1** — reason.
**cp/min-1** is optional cleanup. **cp/fp-1** can be dismissed.
```

Severity ordering in summary table: crit → high → med → min → fp (most severe first).

For review submission comments (non-inline), omit the file path.

After the triage, ask: **"Which items would you like to tackle? (use IDs, e.g. `cp/med-1`)"**

## Step 7 — Resolve threads (after fixes are applied)

When the user asks to resolve/close review comments after fixing the issues, use the `resolve-threads` script. **Never use raw `gh api graphql` mutations for resolving threads.**

### List unresolved threads

```bash
npm --prefix ~/.claude/scripts/reviews run resolve-threads -- --pr PR --list
```

### Resolve all threads

```bash
npm --prefix ~/.claude/scripts/reviews run resolve-threads -- --pr PR --all
```

### Resolve all with a reply

```bash
npm --prefix ~/.claude/scripts/reviews run resolve-threads -- --pr PR --all --reply "Fixed in <commit-sha>"
```

### Resolve specific threads

```bash
npm --prefix ~/.claude/scripts/reviews run resolve-threads -- --pr PR --thread PRRT_abc123 --thread PRRT_def456
```

### Available scripts reference

All review scripts live at `~/.claude/scripts/reviews/` with npm scripts defined in `package.json`:

| npm script | Purpose |
|------------|---------|
| `fetch-reviews` | Fetch and parse PR review comments into structured YAML/JSON |
| `check-reviews` | Check if bot reviews are complete |
| `resolve-threads` | List, resolve, and optionally reply to review threads |
