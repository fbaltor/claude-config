/**
 * Library functions for checking the status of AI review bot check runs.
 */

import { Octokit } from "@octokit/rest";
import {
  AI_REVIEWERS,
  COPILOT_REVIEW_JOB_NAMES,
  COPILOT_WORKFLOW_PATH,
} from "./shared.js";
import type { StatusRenderer } from "./check-reviews-renderer.js";
import { createRenderer } from "./check-reviews-renderer.js";
import {
  fetchFailedCiChecks,
  fetchCiFailureDetails,
  type CiFailure,
} from "./ci-checks.js";

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
  ciFailures?: CiFailure[];
}

export interface WaitOptions {
  rerun?: boolean;
  pollIntervalMs?: number;
  timeoutMs?: number;
  renderer?: StatusRenderer;
  /** Check for CI failures and abort early if found. Default: true when called from --wait. */
  checkCi?: boolean;
}

const POLL_INITIAL_INTERVAL_MS = 10_000; // 10 seconds
const POLL_MAX_INTERVAL_MS = 30_000; // 30 seconds
const POLL_RAMP_AFTER = 3; // ramp to max after this many polls
const POLL_TIMEOUT_MS = 600_000; // 10 minutes

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

async function getHeadSha(
  octokit: Octokit,
  owner: string,
  repo: string,
  pr: number,
): Promise<string> {
  const { data } = await octokit.pulls.get({ owner, repo, pull_number: pr });
  const sha = data.head.sha;
  if (!sha) {
    throw new Error(`Could not get HEAD SHA for PR #${pr}`);
  }
  return sha;
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

/**
 * Extract the workflow run_id from a github-actions check run's details_url.
 * Expected format: https://github.com/OWNER/REPO/actions/runs/RUN_ID/job/JOB_ID
 */
export function extractRunIdFromDetailsUrl(url: string | null | undefined): number | null {
  if (!url) return null;
  const match = url.match(/\/actions\/runs\/(\d+)\/job\/\d+/);
  return match ? parseInt(match[1]!, 10) : null;
}

/**
 * Returns true iff the given workflow run belongs to Copilot's review workflow.
 * Memoizes per run_id via the cache argument. Cache stores the in-flight
 * promise so concurrent lookups collapse to a single API call.
 */
export function isCopilotWorkflowRun(
  octokit: Octokit,
  owner: string,
  repo: string,
  runId: number,
  cache: Map<number, Promise<boolean>>,
): Promise<boolean> {
  const cached = cache.get(runId);
  if (cached !== undefined) return cached;

  const promise = (async () => {
    try {
      const { data } = await octokit.actions.getWorkflowRun({
        owner,
        repo,
        run_id: runId,
      });
      const path = data.path ?? "";
      return (
        path === COPILOT_WORKFLOW_PATH ||
        path.startsWith(`${COPILOT_WORKFLOW_PATH}/`)
      );
    } catch {
      return false;
    }
  })();

  cache.set(runId, promise);
  return promise;
}

/**
 * A "failure" on Agent typically means Copilot opted not to review this PR,
 * not a real CI failure — treat it as neutral so --wait does not abort.
 */
function normalizeCopilotConclusion(conclusion: string | null): string | null {
  return conclusion === "failure" ? "neutral" : conclusion;
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

  // Copilot runs as a github-actions workflow, not under its own app slug.
  // Match on job name + workflow path to avoid picking up unrelated Agent jobs.
  const copilotCandidates = allCheckRuns.filter(
    (run) =>
      (run.app?.slug ?? "") === "github-actions" &&
      COPILOT_REVIEW_JOB_NAMES.includes(run.name),
  );

  const copilotWorkflowCache = new Map<number, Promise<boolean>>();
  const copilotMatches: AiCheckRun[] = (
    await Promise.all(
      copilotCandidates.map(async (run): Promise<AiCheckRun | null> => {
        const runId = extractRunIdFromDetailsUrl(run.details_url);
        if (runId == null) return null;
        const isCopilot = await isCopilotWorkflowRun(
          octokit,
          owner,
          repo,
          runId,
          copilotWorkflowCache,
        );
        if (!isCopilot) return null;
        return {
          id: run.id,
          name: "Copilot",
          status: run.status,
          conclusion: normalizeCopilotConclusion(run.conclusion ?? null),
          appSlug: "copilot-pull-request-reviewer",
          detailsUrl: run.details_url ?? null,
          source: "check_run" as const,
        };
      }),
    )
  ).filter((x): x is AiCheckRun => x !== null);

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

  return [...fromCheckRuns, ...copilotMatches, ...fromStatuses];
}

export async function getCheckStatus(
  octokit: Octokit,
  owner: string,
  repo: string,
  pr: number,
  cachedSha?: string,
): Promise<CheckStatusResult> {
  const headSha = cachedSha ?? await getHeadSha(octokit, owner, repo, pr);
  const checks = await fetchAiCheckRuns(octokit, owner, repo, headSha);

  const allCompleted = checks.length === 0 || checks.every((c) => c.status === "completed");

  return {
    prNumber: pr,
    headSha,
    checks,
    allCompleted,
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
  const timeout = options.timeoutMs ?? POLL_TIMEOUT_MS;
  const renderer = options.renderer ?? createRenderer();
  const checkCi = options.checkCi ?? true;

  let result = await getCheckStatus(octokit, owner, repo, pr);
  const { headSha } = result;
  renderer.render(result);

  if (result.checks.length === 0) {
    console.log("No AI review checks found — proceeding immediately.");
    return result;
  }

  // Check for CI failures immediately on first poll
  if (checkCi) {
    const ciResult = await detectCiFailures(octokit, owner, repo, headSha);
    if (ciResult.length > 0) {
      result.ciFailures = ciResult;
      return result;
    }
  }

  if (options.rerun && result.anyFailed) {
    renderer.reset();
    await rerunFailedChecks(octokit, owner, repo, result.checks);
    console.log("");
  } else if (result.allCompleted) {
    return result;
  }

  const deadline = Date.now() + timeout;
  let pollCount = 0;

  while (Date.now() < deadline) {
    // Adaptive interval: start fast (10s), ramp to 30s after a few polls
    const interval = pollCount < POLL_RAMP_AFTER
      ? POLL_INITIAL_INTERVAL_MS
      : POLL_MAX_INTERVAL_MS;
    await new Promise((resolve) => setTimeout(resolve, options.pollIntervalMs ?? interval));
    pollCount++;

    result = await getCheckStatus(octokit, owner, repo, pr, headSha);
    renderer.update(result);

    // Check for CI failures on each poll
    if (checkCi) {
      const ciResult = await detectCiFailures(octokit, owner, repo, headSha);
      if (ciResult.length > 0) {
        result.ciFailures = ciResult;
        return result;
      }
    }

    if (result.allCompleted) {
      return result;
    }
  }

  console.error("Timeout: AI reviews did not complete within the time limit.");
  return result;
}

// ---------------------------------------------------------------------------
// CI failure detection (used during --wait polling)
// ---------------------------------------------------------------------------

async function detectCiFailures(
  octokit: Octokit,
  owner: string,
  repo: string,
  ref: string,
): Promise<CiFailure[]> {
  const failedChecks = await fetchFailedCiChecks(octokit, owner, repo, ref);
  if (failedChecks.length === 0) return [];

  // Fetch details for all failed checks in parallel
  const details = await Promise.all(
    failedChecks.map((check) =>
      fetchCiFailureDetails(octokit, owner, repo, check, ref),
    ),
  );

  return details;
}
