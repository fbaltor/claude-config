#!/usr/bin/env npx tsx
/**
 * Post-checkout hook: updates the Linear issue status to "Desenvolvimento"
 * after a successful `git checkout` or `git switch` to a Linear branch.
 *
 * Reads Claude Code hook JSON from stdin. Only activates for successful
 * git checkout/switch commands. Extracts the issue ID from the new branch name.
 */

import { appendFileSync } from "node:fs";
import { getCurrentBranch, parseIssueId, updateIssueStatus } from "../scripts/lib/linear.ts";
import { readHookStdin } from "../scripts/lib/hooks.ts";

const LOG_FILE = `${process.env.HOME}/.claude/hooks/hook-debug.log`;

function log(msg: string): void {
  const ts = new Date().toISOString();
  const line = `[${ts}] post-checkout: ${msg}\n`;
  process.stderr.write(line);
  try {
    appendFileSync(LOG_FILE, line);
  } catch {
    // ignore write errors
  }
}

async function main(): Promise<void> {
  const input = await readHookStdin();

  // Only trigger on git checkout / git switch commands
  if (!/^\s*git\s+(checkout|switch)\b/.test(input.tool_input.command)) {
    process.exit(0);
  }
  if (input.tool_response.interrupted) {
    log("skipped: command was interrupted");
    process.exit(0);
  }

  const branch = getCurrentBranch();
  if (!branch) {
    log("skipped: no branch");
    process.exit(0);
  }

  const issueId = parseIssueId(branch);
  if (!issueId) {
    log(`skipped: no issue ID in branch "${branch}"`);
    process.exit(0);
  }

  log(`updating ${issueId} → Desenvolvimento...`);
  const result = await updateIssueStatus(issueId, "Desenvolvimento");
  if (result.success) {
    log(result.message);
  } else {
    log(`FAILED: ${result.message}`);
  }

  process.exit(0);
}

main().catch((err) => {
  log(`ERROR: ${err.message}`);
  process.exit(0); // Don't block on hook errors
});
