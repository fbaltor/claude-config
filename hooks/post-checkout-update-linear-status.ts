#!/usr/bin/env npx tsx
/**
 * Post-checkout hook: updates the Linear issue status to "Desenvolvimento"
 * after a successful `git checkout` or `git switch` to a Linear branch.
 *
 * Reads Claude Code hook JSON from stdin. Only activates for successful
 * git checkout/switch commands. Extracts the issue ID from the new branch name.
 */

import { getCurrentBranch, parseIssueId, updateIssueStatus } from "../scripts/lib/linear.ts";
import { readHookStdin, logHook } from "../scripts/lib/hooks.ts";

const TAG = "post-checkout";

async function main(): Promise<void> {
  const input = await readHookStdin(TAG);

  // Only trigger on new branch creation (git checkout -b / git switch -c)
  if (!/^\s*git\s+(checkout\s+-b|switch\s+(-c|--create))\b/.test(input.tool_input.command)) {
    process.exit(0);
  }
  if (input.tool_response.interrupted) {
    logHook(TAG, "skipped: command was interrupted");
    process.exit(0);
  }

  const branch = getCurrentBranch();
  if (!branch) {
    logHook(TAG, "skipped: no branch");
    process.exit(0);
  }

  const issueId = parseIssueId(branch);
  if (!issueId) {
    logHook(TAG, `skipped: no issue ID in branch "${branch}"`);
    process.exit(0);
  }

  logHook(TAG, `updating ${issueId} → Desenvolvimento...`);
  const result = await updateIssueStatus(issueId, "Desenvolvimento");
  if (result.success) {
    logHook(TAG, result.message);
  } else {
    logHook(TAG, `FAILED: ${result.message}`);
  }

  process.exit(0);
}

main().catch((err) => {
  logHook(TAG, `ERROR: ${err.message}\n${err.stack ?? ""}`);
  process.exit(1); // Exit non-zero so the failure is visible
});
