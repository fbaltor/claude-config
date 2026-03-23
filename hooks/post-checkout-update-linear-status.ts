#!/usr/bin/env npx tsx
/**
 * Post-checkout hook: updates the Linear issue status to "Desenvolvimento"
 * after a successful `git checkout` or `git switch` to a Linear branch.
 *
 * Reads Claude Code hook JSON from stdin. Only activates for successful
 * git checkout/switch commands. Extracts the issue ID from the new branch name.
 */

import { getCurrentBranch, parseIssueId, updateIssueStatus } from "../scripts/lib/linear.ts";

interface HookInput {
  tool_input: { command: string };
  tool_response: { output: string; exitCode: number };
  cwd: string;
}

async function main(): Promise<void> {
  const raw = await new Promise<string>((resolve) => {
    let data = "";
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
  });

  const input: HookInput = JSON.parse(raw);

  // Only trigger on git checkout / git switch commands
  if (!/^\s*git\s+(checkout|switch)\b/.test(input.tool_input.command)) {
    process.exit(0);
  }
  if (input.tool_response.exitCode !== 0) {
    process.exit(0);
  }

  const branch = getCurrentBranch();
  if (!branch) {
    process.exit(0);
  }

  const issueId = parseIssueId(branch);
  if (!issueId) {
    process.exit(0);
  }

  const result = await updateIssueStatus(issueId, "Desenvolvimento");
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
