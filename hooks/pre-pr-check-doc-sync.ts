#!/usr/bin/env npx tsx
/**
 * Pre-PR hook: checks if Linear-linked docs are in sync before `gh pr create`.
 *
 * Reads Claude Code hook JSON from stdin. Only activates for `gh pr create` commands.
 * Exits with code 2 (blocking) if any docs are out of sync.
 */

import {
  findLinearLinkedDocs,
  checkDocSync,
  getCurrentBranch,
  parseIssueId,
} from "../scripts/lib/linear.ts";

interface HookInput {
  tool_input: { command: string };
  cwd: string;
}

async function main(): Promise<void> {
  const raw = await new Promise<string>((resolve) => {
    let data = "";
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
  });

  const input: HookInput = JSON.parse(raw);

  // Only trigger when the command itself is `gh pr create`, not when the string
  // appears inside arguments (e.g. a commit message mentioning "gh pr create")
  if (!/^\s*gh\s+pr\s+create\b/.test(input.tool_input.command)) {
    process.exit(0);
  }

  // Only trigger on Linear branches (JUMP-*/GOJ-* pattern)
  const branch = getCurrentBranch();
  if (!branch || !parseIssueId(branch)) {
    process.exit(0);
  }

  const docs = findLinearLinkedDocs(input.cwd);
  if (docs.length === 0) {
    process.exit(0);
  }

  const outOfSync: string[] = [];
  for (const doc of docs) {
    const result = await checkDocSync(input.cwd, doc);
    if (result) outOfSync.push(result);
  }

  if (outOfSync.length > 0) {
    const lines = [
      "Linear docs out of sync with local files:",
      ...outOfSync.map((d) => `  - ${d}`),
      "",
      "Run /linear-push-doc to sync before creating the PR.",
    ];
    process.stderr.write(lines.join("\n") + "\n");
    process.exit(2);
  }

  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`Hook error: ${err.message}\n`);
  process.exit(0); // Don't block on hook errors
});
