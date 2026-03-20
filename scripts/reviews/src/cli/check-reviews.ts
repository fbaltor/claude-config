#!/usr/bin/env node

/**
 * CLI entry point for checking AI review bot check run status.
 *
 * Usage:
 *   npx tsx src/cli/check-reviews.ts [--pr <number>] [--wait] [--rerun]
 *
 * If --pr is omitted, the script tries to detect the PR from the current branch.
 * Requires: `gh` CLI authenticated with repo access, or GITHUB_TOKEN env var.
 */

import { Octokit } from "@octokit/rest";
import { getGitHubToken, parseCommonArgs } from "../cli-utils.js";
import {
  getCheckStatus,
  waitForCompletion,
  rerunFailedChecks,
} from "../check-reviews.js";
import { createRenderer } from "../check-reviews-renderer.js";

// ---------------------------------------------------------------------------
// CLI arg parsing
// ---------------------------------------------------------------------------

interface StatusCliArgs {
  pr: number;
  owner: string;
  repo: string;
  wait: boolean;
  rerun: boolean;
}

function printHelp(): never {
  console.log(`Usage: npx tsx src/cli/check-reviews.ts [options]

Checks the status of AI review bot checks on a GitHub PR.

Options:
  --pr <number>      PR number (auto-detects from current branch if omitted)
  --repo owner/repo  Target repository (default: Jumpstart-Immigration/jumpstart)
  --wait             Poll until all AI reviews complete (30s interval, 10m timeout)
  --rerun            Re-trigger any failed check runs
  --help             Show this help message

Examples:
  npx tsx src/cli/check-reviews.ts
  npx tsx src/cli/check-reviews.ts --wait
  npx tsx src/cli/check-reviews.ts --rerun
  npx tsx src/cli/check-reviews.ts --wait --rerun
  npx tsx src/cli/check-reviews.ts --pr 50`);
  process.exit(0);
}

function parseStatusArgs(): StatusCliArgs {
  const args = process.argv.slice(2);
  if (args.includes("--help")) printHelp();

  const common = parseCommonArgs(args);
  return {
    ...common,
    wait: args.includes("--wait"),
    rerun: args.includes("--rerun"),
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { pr, owner, repo, wait, rerun } = parseStatusArgs();

  const octokit = new Octokit({ auth: getGitHubToken() });
  const renderer = createRenderer();

  if (wait) {
    const result = await waitForCompletion(octokit, owner, repo, pr, {
      rerun,
      renderer,
    });
    process.exit(result.allCompleted && !result.anyFailed ? 0 : 1);
  }

  const result = await getCheckStatus(octokit, owner, repo, pr);
  renderer.render(result);

  if (rerun && result.anyFailed) {
    await rerunFailedChecks(octokit, owner, repo, result.checks);
  }

  if (result.anyFailed) {
    process.exit(1);
  }
}

const isMainModule = process.argv[1]?.endsWith("check-reviews.ts");
if (isMainModule) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
