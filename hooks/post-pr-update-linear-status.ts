#!/usr/bin/env npx tsx
/**
 * Post-PR hook: updates the Linear issue status to "Code review" after `gh pr create` succeeds.
 *
 * Reads Claude Code hook JSON from stdin. Only activates for successful `gh pr create` commands.
 * Extracts the issue ID from the current git branch name.
 */

import { getCurrentBranch, parseIssueId, updateIssueStatus } from "../scripts/lib/linear.ts";
import { readHookStdin } from "../scripts/lib/hooks.ts";

async function main(): Promise<void> {
  const input = await readHookStdin();

  // Only trigger when the command itself is `gh pr create`
  if (!/^\s*gh\s+pr\s+create\b/.test(input.tool_input.command)) {
    process.exit(0);
  }
  if (input.tool_response.interrupted) {
    process.exit(0);
  }

  // Only trigger on Linear branches (JUMP-*/GOJ-* pattern)
  const branch = getCurrentBranch();
  if (!branch) {
    process.exit(0);
  }

  const issueId = parseIssueId(branch);
  if (!issueId) {
    process.exit(0);
  }

  const result = await updateIssueStatus(issueId, "Code review");
  if (result.success) {
    process.stderr.write(`Linear: ${result.message}\n`);
  } else {
    process.stderr.write(`Linear status update failed: ${result.message}\n`);
  }

  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`Hook error: ${err.message}\n`);
  process.exit(0); // Don't block on hook errors
});
