---
description: Fetch all PR review comments (human + bot), analyze them against the source code, and classify as false positive / minor / major
model: opus
argument-hint: "[--pr <number>] [--repo owner/repo]"
disable-model-invocation: true
allowed-tools: [Read, Bash, Grep, Glob]
---

# Triage PR Reviews

Fetch all review comments from a GitHub PR, read the relevant source code, and classify each comment as **false positive**, **minor**, or **major**.

## Step 1 — Resolve PR number

Parse `$ARGUMENTS` for:

- `--pr <number>` — PR number
- `--repo owner/repo` — target repository (default: `Jumpstart-Immigration/jumpstart`)

If `--pr` is omitted, detect from the current branch:

```bash
gh pr list --repo OWNER/REPO --head "$(git branch --show-current)" --json number --jq '.[0].number'
```

If detection fails, stop and ask the user.

## Step 2 — Fetch review data

Run **two** `gh api graphql` calls **in parallel**. Replace OWNER, REPO, PR with the resolved values.

### 2a. Review threads (inline comments)

```bash
gh api graphql --paginate -f query='
query($owner:String!,$repo:String!,$pr:Int!,$endCursor:String){
  repository(owner:$owner,name:$repo){
    pullRequest(number:$pr){
      author{login}
      title
      url
      reviewDecision
      reviewThreads(first:100,after:$endCursor){
        pageInfo{hasNextPage endCursor}
        nodes{
          id path line startLine isResolved isOutdated
          comments(first:100){
            nodes{id body createdAt url author{__typename login}}
          }
        }
      }
    }
  }
}' -F owner=OWNER -F repo=REPO -F pr=PR
```

### 2b. Review submissions (top-level review bodies)

```bash
gh api graphql --paginate -f query='
query($owner:String!,$repo:String!,$pr:Int!,$endCursor:String){
  repository(owner:$owner,name:$repo){
    pullRequest(number:$pr){
      reviews(first:100,after:$endCursor){
        pageInfo{hasNextPage endCursor}
        nodes{id state body submittedAt author{__typename login}}
      }
    }
  }
}' -F owner=OWNER -F repo=REPO -F pr=PR
```

## Step 3 — Filter to actionable comments

From the fetched data, extract only **actionable** review feedback:

- **Skip** resolved threads (`isResolved: true`) — count them for the summary
- **Skip** comments authored by the PR author (self-replies, not review feedback)
- **Skip** review submissions with empty bodies (approval/request-changes signals with no text)
- **Flag** outdated threads (`isOutdated: true`) — include but mark as `[outdated]`

Within each thread, the **first comment** is the review point; subsequent comments are discussion/replies. Focus classification on the review point but use discussion to inform your assessment (e.g., a reply saying "good point, will fix" suggests the issue is acknowledged).

## Step 4 — Read source code

For each unresolved inline thread, you need the actual code to assess the comment accurately.

1. Collect all unique file paths from the threads.
2. For each file, read it with the Read tool. If multiple threads reference the same file, read the file **once**.
3. Make **parallel** Read calls — batch all file reads into a single response.
4. If a file no longer exists (deleted/renamed), note that the comment may be moot.

## Step 5 — Classify each comment

For each comment, consider **both** the reviewer's text **and** the actual source code:

| Classification      | Criteria                                                                                                                                                         |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **False positive**  | The concern is factually incorrect, already addressed in the current code, based on a misunderstanding, or not applicable to this context                        |
| **Minor**           | Style/naming suggestions, small readability improvements, documentation tweaks, nitpicks — things that don't affect correctness, security, or performance        |
| **Major**           | Bugs, security vulnerabilities, logic errors, missing error handling, data loss risks, significant performance problems, architectural concerns — real impact     |

Guidelines:

- When a bot provides structured severity (CodeRabbit emoji badges, Kody severity levels), use it as a **signal** but verify independently against the code.
- If a review submission body raises multiple distinct issues, break them into separate classified items.
- If the thread discussion shows the issue was acknowledged but not yet fixed, still classify based on severity.
- When uncertain, lean toward the higher severity classification.

## Step 6 — Present triage

Output the triage in this format:

```
## PR Review Triage

**PR #N**: title
**Reviewers**: @alice, @copilot[bot], @coderabbitai[bot]
**Decision**: APPROVED / CHANGES_REQUESTED / REVIEW_REQUIRED
**Stats**: X major | Y minor | Z false positives | W resolved (skipped)

---

### Major (X)

1. **Short description** — @reviewer
   `file/path.ts:42` · [link](comment-url)
   > Reviewer's comment (first ~3 lines)

   **Assessment**: Why this is major and what needs to change.

2. ...

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
```

For review submission comments (non-inline), omit the file path line.

After the triage, ask: **"Which items would you like to tackle?"**
