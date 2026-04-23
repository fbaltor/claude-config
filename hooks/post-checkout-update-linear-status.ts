#!/usr/bin/env npx tsx
/**
 * Post-checkout hook: updates the Linear issue status to "Desenvolvimento"
 * after a successful git command that creates a branch with a Linear-style
 * name (e.g. `baltor/jump-326-…`).
 *
 * The branch name is parsed directly from the command so the hook works even
 * when the new branch is checked out in a different path from where the hook
 * runs — critical for `git worktree add -b`, where the hook's cwd is still
 * the parent repo on `main`.
 *
 * Supported forms:
 *   git checkout -b <branch> [...]
 *   git switch -c|-C|--create <branch> [...]
 *   git worktree add -b|-B <branch> <path> [...]
 *
 * Tolerates global flags before the subcommand (`git -C <path> checkout -b …`).
 */

import { pathToFileURL } from "node:url";

import { parseIssueId, updateIssueStatus } from "../scripts/lib/linear.ts";
import { readHookStdin, logHook } from "../scripts/lib/hooks.ts";

const TAG = "post-checkout";

// Global flags that consume a separate argument and must be skipped when
// locating the subcommand keyword after `git`.
const GIT_GLOBAL_FLAGS_WITH_ARG = new Set([
  "-C",
  "-c",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--exec-path",
  "--super-prefix",
]);

/**
 * Extract the new-branch name from a git command that creates a branch,
 * or null if the command isn't a recognized branch-creating form.
 *
 * Branch names cannot contain whitespace, so naive splitting on `\s+` is safe.
 */
export function parseNewBranch(cmd: string): string | null {
  const tokens = cmd.trim().split(/\s+/);
  const gitIdx = tokens.indexOf("git");
  if (gitIdx < 0) return null;

  let i = gitIdx + 1;
  while (i < tokens.length && tokens[i].startsWith("-")) {
    if (GIT_GLOBAL_FLAGS_WITH_ARG.has(tokens[i])) {
      i += 2;
    } else {
      i += 1;
    }
  }
  if (i >= tokens.length) return null;

  const sub = tokens[i];
  let flags: Set<string>;
  let scanStart: number;

  if (sub === "checkout") {
    flags = new Set(["-b", "-B"]);
    scanStart = i + 1;
  } else if (sub === "switch") {
    flags = new Set(["-c", "-C", "--create"]);
    scanStart = i + 1;
  } else if (sub === "worktree" && tokens[i + 1] === "add") {
    flags = new Set(["-b", "-B"]);
    scanStart = i + 2;
  } else {
    return null;
  }

  for (let j = scanStart; j < tokens.length - 1; j++) {
    if (flags.has(tokens[j])) {
      return tokens[j + 1].replace(/^['"]|['"]$/g, "");
    }
  }
  return null;
}

async function main(): Promise<void> {
  const input = await readHookStdin(TAG);

  if (input.tool_response.interrupted) {
    logHook(TAG, "skipped: command was interrupted");
    process.exit(0);
  }

  const branch = parseNewBranch(input.tool_input.command);
  if (!branch) {
    process.exit(0);
  }

  const issueId = parseIssueId(branch);
  if (!issueId) {
    logHook(TAG, `skipped: no issue ID in branch "${branch}"`);
    process.exit(0);
  }

  logHook(TAG, `updating ${issueId} → Desenvolvimento (branch: ${branch})...`);
  const result = await updateIssueStatus(issueId, "Desenvolvimento");
  if (result.success) {
    logHook(TAG, result.message);
  } else {
    logHook(TAG, `FAILED: ${result.message}`);
  }

  process.exit(0);
}

const isEntryPoint = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
if (isEntryPoint) {
  main().catch((err) => {
    logHook(TAG, `ERROR: ${err.message}\n${err.stack ?? ""}`);
    process.exit(1);
  });
}
