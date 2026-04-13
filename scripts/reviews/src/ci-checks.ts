/**
 * Library functions for detecting and reporting CI check failures.
 *
 * Fetches non-AI check runs that have failed, retrieves job steps,
 * annotations, and log excerpts, and produces structured YAML output.
 */

import yaml from "js-yaml";
import { Octokit } from "@octokit/rest";
import { AI_REVIEWERS, IGNORED_CI_CHECK_NAMES } from "./shared.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CiAnnotation {
  level: "failure" | "warning" | "notice";
  file: string;
  line: number | null;
  end_line: number | null;
  message: string;
}

export interface CiStep {
  name: string;
  conclusion: string;
}

export interface CiFailure {
  job_name: string;
  job_id: number;
  workflow_name: string | null;
  url: string;
  sha: string;
  duration_seconds: number | null;
  failed_step: string | null;
  steps: CiStep[];
  annotations: CiAnnotation[];
  log_excerpt: string | null;
}

export interface CiFailureReport {
  schema: "ci-failure-report";
  failures: CiFailure[];
}

// ---------------------------------------------------------------------------
// Detect failed CI checks
// ---------------------------------------------------------------------------

/**
 * Scan check runs for non-AI failures. Returns the failed check run IDs
 * and basic info needed to fetch details.
 */
export async function fetchFailedCiChecks(
  octokit: Octokit,
  owner: string,
  repo: string,
  ref: string,
): Promise<Array<{ id: number; name: string; appSlug: string; detailsUrl: string | null }>> {
  const allCheckRuns = await octokit.paginate(octokit.checks.listForRef, {
    owner,
    repo,
    ref,
    filter: "latest",
    per_page: 100,
  });

  return allCheckRuns
    .filter((run) => {
      const slug = run.app?.slug ?? "";
      // Skip AI review bots — those are handled by check-reviews
      if (AI_REVIEWERS.includes(slug)) return false;
      // Skip known AI review jobs that run as GitHub Actions (same app_slug)
      if (IGNORED_CI_CHECK_NAMES.includes(run.name)) return false;
      // Only completed failures
      if (run.status !== "completed") return false;
      if (run.conclusion === "success" || run.conclusion === "neutral" || run.conclusion === "skipped") return false;
      // Skip cancelled checks — not a CI failure
      if (run.conclusion === "cancelled") return false;
      return true;
    })
    .map((run) => ({
      id: run.id,
      name: run.name,
      appSlug: run.app?.slug ?? "unknown",
      detailsUrl: run.details_url ?? null,
    }));
}

// ---------------------------------------------------------------------------
// Fetch details for a failed check
// ---------------------------------------------------------------------------

/**
 * Fetch detailed failure info for a check run: job steps, annotations, and
 * a log excerpt from the failed step.
 */
export async function fetchCiFailureDetails(
  octokit: Octokit,
  owner: string,
  repo: string,
  checkRun: { id: number; name: string; appSlug: string; detailsUrl: string | null },
  ref: string,
): Promise<CiFailure> {
  // Fetch job steps, annotations, and logs in parallel
  const [jobResult, annotationsResult, logResult] = await Promise.allSettled([
    checkRun.appSlug === "github-actions"
      ? octokit.actions.getJobForWorkflowRun({ owner, repo, job_id: checkRun.id })
      : Promise.resolve(null),
    octokit.checks.listAnnotations({ owner, repo, check_run_id: checkRun.id, per_page: 100 }),
    checkRun.appSlug === "github-actions"
      ? fetchJobLogs(octokit, owner, repo, checkRun.id)
      : Promise.resolve(null),
  ]);

  // Parse job steps
  let steps: CiStep[] = [];
  let failedStep: string | null = null;
  let workflowName: string | null = null;
  let durationSeconds: number | null = null;

  if (jobResult.status === "fulfilled" && jobResult.value) {
    const job = jobResult.value.data;
    steps = (job.steps ?? []).map((s) => ({
      name: s.name,
      conclusion: s.conclusion ?? "unknown",
    }));
    const failed = (job.steps ?? []).find((s) => s.conclusion === "failure");
    failedStep = failed?.name ?? null;

    if (job.started_at && job.completed_at) {
      durationSeconds = Math.round(
        (new Date(job.completed_at).getTime() - new Date(job.started_at).getTime()) / 1000,
      );
    }
  }

  // Parse annotations — filter out meta annotations from .github path
  let annotations: CiAnnotation[] = [];
  if (annotationsResult.status === "fulfilled") {
    annotations = annotationsResult.value.data
      .filter((a) => {
        // Skip generic "Process completed with exit code" annotations
        if (a.path === ".github" && a.annotation_level === "failure") return false;
        return true;
      })
      .map((a) => ({
        level: a.annotation_level as CiAnnotation["level"],
        file: a.path ?? "",
        line: a.start_line ?? null,
        end_line: a.end_line ?? null,
        message: a.message ?? "",
      }));
  }

  // Parse log excerpt — extract error lines from the failed step
  let logExcerpt: string | null = null;
  if (logResult.status === "fulfilled" && logResult.value) {
    logExcerpt = extractFailedStepLog(logResult.value, failedStep);
  }

  return {
    job_name: checkRun.name,
    job_id: checkRun.id,
    workflow_name: workflowName,
    url: checkRun.detailsUrl ?? "",
    sha: ref,
    duration_seconds: durationSeconds,
    failed_step: failedStep,
    steps,
    annotations,
    log_excerpt: logExcerpt,
  };
}

// ---------------------------------------------------------------------------
// Log fetching and parsing
// ---------------------------------------------------------------------------

async function fetchJobLogs(
  octokit: Octokit,
  owner: string,
  repo: string,
  jobId: number,
): Promise<string | null> {
  try {
    const response = await octokit.actions.downloadJobLogsForWorkflowRun({
      owner,
      repo,
      job_id: jobId,
    });
    // The response is a redirect URL or string data
    return typeof response.data === "string" ? response.data : String(response.data);
  } catch {
    return null;
  }
}

/**
 * Extract the log section for the failed step, returning only error lines
 * and surrounding context. Strips timestamps and GitHub Actions markers.
 *
 * Log format:
 *   2026-04-07T22:33:45.123Z ##[group]Step Name
 *   2026-04-07T22:33:45.123Z ... output ...
 *   2026-04-07T22:33:45.123Z ##[endgroup]
 *   2026-04-07T22:33:45.123Z ##[error]Error message
 */
export function extractFailedStepLog(
  rawLog: string,
  failedStepName: string | null,
): string | null {
  const lines = rawLog.split("\n");

  // Strategy 1: If we know the failed step, extract its section
  if (failedStepName) {
    const section = extractStepSection(lines, failedStepName);
    if (section) return section;
  }

  // Strategy 2: Extract all ##[error] lines as a fallback
  const errorLines = lines
    .filter((l) => l.includes("##[error]"))
    .map(stripTimestamp)
    .map((l) => l.replace(/^##\[error\]/, ""))
    .filter((l) => !l.includes("Process completed with exit code"));

  if (errorLines.length > 0) {
    return errorLines.join("\n");
  }

  return null;
}

function extractStepSection(lines: string[], stepName: string): string | null {
  let inStep = false;
  const captured: string[] = [];

  for (const line of lines) {
    const stripped = stripTimestamp(line);

    if (stripped.startsWith("##[group]") && stripped.includes(stepName)) {
      inStep = true;
      continue;
    }

    if (inStep) {
      if (stripped === "##[endgroup]") break;
      // Skip empty lines and github internal markers
      if (stripped.startsWith("##[")) continue;
      captured.push(stripped);
    }
  }

  if (captured.length === 0) return null;

  // Keep the last 50 lines (most relevant — errors are at the end)
  const tail = captured.slice(-50);
  const trimmed = tail.join("\n").trim();
  return trimmed || null;
}

function stripTimestamp(line: string): string {
  // Timestamps look like: 2026-04-07T22:33:45.1234567Z
  return line.replace(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z\s*/, "");
}

// ---------------------------------------------------------------------------
// YAML output
// ---------------------------------------------------------------------------

export function buildCiFailureYaml(failures: CiFailure[]): string {
  const report: CiFailureReport = {
    schema: "ci-failure-report",
    failures,
  };

  return yaml.dump(report, {
    lineWidth: 120,
    noRefs: true,
    quotingType: '"',
    forceQuotes: false,
  });
}
