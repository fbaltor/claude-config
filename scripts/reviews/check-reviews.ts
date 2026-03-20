/**
 * Checks the status of AI review bot check runs on a GitHub PR.
 *
 * Usage:
 *   pnpm check-reviews [--pr <number>] [--wait] [--rerun]
 *
 * If --pr is omitted, the script tries to detect the PR from the current branch.
 * Requires: `gh` CLI authenticated with repo access, or GITHUB_TOKEN env var.
 */

import { execFileSync } from "node:child_process";
import { Octokit } from "@octokit/rest";
import { getGitHubToken, parseCommonArgs } from "./cli-utils.js";
import { AI_REVIEWERS } from "./shared.js";
import type { StatusRenderer } from "./check-reviews-renderer.js";
import { createRenderer } from "./check-reviews-renderer.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AiCheckRun {
  id: number;
  name: string;
  status: string; // "queued" | "in_progress" | "completed"
  conclusion: string | null; // "success" | "failure" | "neutral" | "cancelled" | "timed_out" | "action_required" | null
  appSlug: string;
  detailsUrl: string | null;
  source: "check_run" | "commit_status";
}

export interface CheckStatusResult {
  prNumber: number;
  headSha: string;
  checks: AiCheckRun[];
  allCompleted: boolean;
  anyFailed: boolean;
}

interface StatusCliArgs {
  pr: number;
  owner: string;
  repo: string;
  wait: boolean;
  rerun: boolean;
}

export interface WaitOptions {
  rerun?: boolean;
  pollIntervalMs?: number;
  timeoutMs?: number;
  renderer?: StatusRenderer;
}

const POLL_INTERVAL_MS = 30_000; // 30 seconds
const POLL_TIMEOUT_MS = 600_000; // 10 minutes

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

function getHeadSha(owner: string, repo: string, pr: number): string {
  const result = execFileSync(
    "gh",
    [
      "pr", "view", String(pr),
      "--repo", `${owner}/${repo}`,
      "--json", "headRefOid",
      "--jq", ".headRefOid",
    ],
    { encoding: "utf-8" },
  ).trim();
  if (!result) {
    console.error(`Could not get HEAD SHA for PR #${pr}`);
    process.exit(1);
  }
  return result;
}

/** Map commit status state to the check_run status/conclusion model. */
function mapCommitStatusState(state: string): {
  status: string;
  conclusion: string | null;
} {
  switch (state) {
    case "success":
      return { status: "completed", conclusion: "success" };
    case "failure":
    case "error":
      return { status: "completed", conclusion: "failure" };
    case "pending":
      return { status: "in_progress", conclusion: null };
    default:
      return { status: state, conclusion: null };
  }
}

export function isFailedCheck(check: AiCheckRun): boolean {
  return (
    check.status === "completed" &&
    check.conclusion !== "success" &&
    check.conclusion !== "neutral" &&
    check.conclusion !== "skipped"
  );
}

export async function fetchAiCheckRuns(
  octokit: Octokit,
  owner: string,
  repo: string,
  ref: string,
): Promise<AiCheckRun[]> {
  // Paginate both check runs and commit statuses in parallel
  const [allCheckRuns, allStatuses] = await Promise.all([
    octokit.paginate(octokit.checks.listForRef, {
      owner,
      repo,
      ref,
      filter: "latest",
      per_page: 100,
    }),
    octokit.paginate(octokit.repos.listCommitStatusesForRef, {
      owner,
      repo,
      ref,
      per_page: 100,
    }),
  ]);

  // Filter check runs to known AI review bots
  const fromCheckRuns: AiCheckRun[] = allCheckRuns
    .filter((run) => {
      const slug = run.app?.slug ?? "";
      return AI_REVIEWERS.includes(slug);
    })
    .map((run) => ({
      id: run.id,
      name: run.name,
      status: run.status,
      conclusion: run.conclusion ?? null,
      appSlug: run.app?.slug ?? "unknown",
      detailsUrl: run.details_url ?? null,
      source: "check_run" as const,
    }));

  // Filter commit statuses to known AI review bots
  // Deduplicate by context (keep latest — the API returns most recent first)
  const seenContexts = new Set<string>();
  const fromStatuses: AiCheckRun[] = [];

  for (const status of allStatuses) {
    const login = status.creator?.login ?? "";
    const botName = login.replace("[bot]", "");
    if (!login || !AI_REVIEWERS.includes(botName)) continue;
    if (seenContexts.has(status.context)) continue;
    seenContexts.add(status.context);

    const mapped = mapCommitStatusState(status.state);
    fromStatuses.push({
      id: status.id,
      name: status.context,
      status: mapped.status,
      conclusion: mapped.conclusion,
      appSlug: botName,
      detailsUrl: status.target_url ?? null,
      source: "commit_status" as const,
    });
  }

  return [...fromCheckRuns, ...fromStatuses];
}

export async function getCheckStatus(
  octokit: Octokit,
  owner: string,
  repo: string,
  pr: number,
  cachedSha?: string,
): Promise<CheckStatusResult> {
  const headSha = cachedSha ?? getHeadSha(owner, repo, pr);
  const checks = await fetchAiCheckRuns(octokit, owner, repo, headSha);

  return {
    prNumber: pr,
    headSha,
    checks,
    allCompleted:
      checks.length > 0 && checks.every((c) => c.status === "completed"),
    anyFailed: checks.some(isFailedCheck),
  };
}

// ---------------------------------------------------------------------------
// Re-run failed checks
// ---------------------------------------------------------------------------

export async function rerunFailedChecks(
  octokit: Octokit,
  owner: string,
  repo: string,
  checks: AiCheckRun[],
): Promise<void> {
  const failed = checks.filter(isFailedCheck);

  if (failed.length === 0) {
    console.log("No failed checks to re-run.");
    return;
  }

  for (const check of failed) {
    if (check.source === "commit_status") {
      console.log(
        `Skipping ${check.name} — commit statuses cannot be re-requested.`,
      );
      continue;
    }
    console.log(`Re-running failed check: ${check.name}...`);
    try {
      await octokit.checks.rerequestRun({
        owner,
        repo,
        check_run_id: check.id,
      });
      console.log(`Successfully re-requested ${check.name} review.`);
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 403 || status === 404) {
        console.log(
          `Could not re-request ${check.name} — the check run belongs to a third-party GitHub App (${status}).`,
        );
      } else {
        throw err;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Wait / polling
// ---------------------------------------------------------------------------

export async function waitForCompletion(
  octokit: Octokit,
  owner: string,
  repo: string,
  pr: number,
  options: WaitOptions = {},
): Promise<CheckStatusResult> {
  const pollInterval = options.pollIntervalMs ?? POLL_INTERVAL_MS;
  const timeout = options.timeoutMs ?? POLL_TIMEOUT_MS;
  const renderer = options.renderer ?? createRenderer();

  let result = await getCheckStatus(octokit, owner, repo, pr);
  const { headSha } = result;
  renderer.render(result);

  if (options.rerun && result.anyFailed) {
    renderer.reset();
    await rerunFailedChecks(octokit, owner, repo, result.checks);
    console.log("");
  } else if (result.allCompleted) {
    return result;
  }

  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
    result = await getCheckStatus(octokit, owner, repo, pr, headSha);
    renderer.update(result);

    if (result.allCompleted) {
      return result;
    }
  }

  console.error("Timeout: AI reviews did not complete within the time limit.");
  return result;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function printHelp(): never {
  console.log(`Usage: pnpm check-reviews [options]

Checks the status of AI review bot checks on a GitHub PR.

Options:
  --pr <number>      PR number (auto-detects from current branch if omitted)
  --repo owner/repo  Target repository (default: Jumpstart-Immigration/jumpstart)
  --wait             Poll until all AI reviews complete (30s interval, 10m timeout)
  --rerun            Re-trigger any failed check runs
  --help             Show this help message

Examples:
  pnpm check-reviews
  pnpm check-reviews --wait
  pnpm check-reviews --rerun
  pnpm check-reviews --wait --rerun
  pnpm check-reviews --pr 50`);
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
