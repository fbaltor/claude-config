---
description: Fetch all PR review comments (human + bot), analyze them against the source code, and classify as false positive / minor / major
model: opus
argument-hint: "[--wait] [--pr <number>] [--repo owner/repo]"
disable-model-invocation: true
allowed-tools: [Read, Bash, Grep, Glob]
---

# Triage PR Reviews

Fetch all review comments from a GitHub PR via the review scripts, read the relevant source code, and classify each comment as **false positive**, **minor**, or **major**. Outdated comments are presented separately.

## Step 1 — Resolve arguments

Parse `$ARGUMENTS` for:

- `--pr <number>` — PR number (if omitted, the script auto-detects from current branch)
- `--repo owner/repo` — target repository (default: `Jumpstart-Immigration/jumpstart`)
- `--wait` — wait for bot reviews to complete before fetching

## Step 2 — Fetch review data

### Without `--wait`:

```bash
npx tsx "$HOME/.claude/scripts/reviews/src/cli/fetch-reviews.ts" --pr PR --repo OWNER/REPO
```

### With `--wait`:

Run the fetch command with `--wait` using the Bash tool with `run_in_background: true`:

```bash
npx tsx "$HOME/.claude/scripts/reviews/src/cli/fetch-reviews.ts" --wait --pr PR --repo OWNER/REPO
```

Tell the user: "Waiting for bot reviews to complete. I'll proceed with triage when ready."
When the background process completes, continue with the next step.

### Read the YAML output

The script prints file paths to stdout. Look for the `.yaml` path in the output and read that file with the Read tool.

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

Output the triage in this format:

```
## PR Review Triage

**PR #N**: title
**Reviewers**: @alice, @copilot[bot], @coderabbitai[bot]
**Stats**: X major | Y minor | Z false positives | W outdated | V resolved (skipped)

---

### Major (X)

1. **Short description** — @reviewer
   `file/path.ts:42` · [link](comment-url)
   > Reviewer's comment (first ~3 lines)

   **Assessment**: Why this is major and what needs to change.

### Minor (Y)

1. **Short description** — @reviewer
   `file/path.ts:15` · [link](comment-url)
   > Reviewer's comment

   **Assessment**: Brief note.

### False Positives (Z)

1. **Short description** — @reviewer
   `file/path.ts:88` · [link](comment-url)
   > Reviewer's comment

   **Assessment**: Why this is a false positive.

### Outdated (W)

_These comments are on code that has changed since the review. They may or may not still be relevant._

1. **Short description** — @reviewer
   `file/path.ts:20` · [link](comment-url) · `[outdated]`
   > Reviewer's comment
```

For review submission comments (non-inline), omit the file path line.

After the triage, ask: **"Which items would you like to tackle?"**
