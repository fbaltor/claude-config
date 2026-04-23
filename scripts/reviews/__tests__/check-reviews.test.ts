import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";

import {
  extractRunIdFromDetailsUrl,
  fetchAiCheckRuns,
  fetchPendingAiReviewRequests,
  getCheckStatus,
  isFailedCheck,
  rerunFailedChecks,
  type AiCheckRun,
  type CheckStatusResult,
} from "../src/check-reviews.js";

// ---------------------------------------------------------------------------
// Mock Octokit factory
// ---------------------------------------------------------------------------

interface MockCheckRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  app: { slug: string } | null;
  details_url: string | null;
}

interface MockCommitStatus {
  id: number;
  context: string;
  state: string;
  target_url: string | null;
  creator: { login: string } | null;
}

interface MockRequestedReviewer {
  login: string;
  id: number;
}

function makeMockOctokit(
  checkRuns: MockCheckRun[] = [],
  statuses: MockCommitStatus[] = [],
  workflowRunsByRunId: Record<number, { path: string }> = {},
  requestedReviewers: MockRequestedReviewer[] = [],
) {
  const checksListForRef = Object.assign(
    mock.fn(async () => ({ data: { check_runs: checkRuns } })),
    { _mockData: checkRuns },
  );
  const statusesListForRef = Object.assign(
    mock.fn(async () => ({ data: statuses })),
    { _mockData: statuses },
  );
  const getWorkflowRun = mock.fn(async ({ run_id }: { run_id: number }) => {
    const wf = workflowRunsByRunId[run_id];
    if (!wf) {
      const err = new Error("Not Found") as Error & { status: number };
      err.status = 404;
      throw err;
    }
    return { data: wf };
  });
  const listRequestedReviewers = mock.fn(async () => ({
    data: { users: requestedReviewers, teams: [] },
  }));

  return {
    checks: {
      listForRef: checksListForRef,
      rerequestRun: mock.fn(async () => ({})),
    },
    repos: {
      listCommitStatusesForRef: statusesListForRef,
    },
    actions: {
      getWorkflowRun,
    },
    pulls: {
      listRequestedReviewers,
    },
    paginate: mock.fn(async (method: unknown) => {
      const fn = method as { _mockData?: unknown[] };
      if (fn._mockData !== undefined) return fn._mockData;
      const response = await (method as () => Promise<{ data: unknown }>)();
      return response.data;
    }),
  };
}

// ---------------------------------------------------------------------------
// Helper to compute allCompleted / anyFailed (mirrors getCheckStatus logic)
// ---------------------------------------------------------------------------

function computeStatus(checks: AiCheckRun[]): Pick<CheckStatusResult, "allCompleted" | "anyFailed"> {
  return {
    allCompleted:
      checks.length === 0 || checks.every((c) => c.status === "completed"),
    anyFailed: checks.some(isFailedCheck),
  };
}

// ---------------------------------------------------------------------------
// fetchAiCheckRuns — check run filtering
// ---------------------------------------------------------------------------

describe("fetchAiCheckRuns", () => {
  describe("check run filtering", () => {
    it("keeps AI review bot check runs", async () => {
      const octokit = makeMockOctokit(
        [
          {
            id: 1,
            name: "Code Review",
            status: "completed",
            conclusion: "success",
            app: { slug: "kody-ai" },
            details_url: "https://example.com",
          },
        ],
        [],
      );

      const result = await fetchAiCheckRuns(octokit as never, "o", "r", "abc123");

      assert.equal(result.length, 1);
      assert.equal(result[0]!.name, "Code Review");
      assert.equal(result[0]!.appSlug, "kody-ai");
      assert.equal(result[0]!.source, "check_run");
    });

    it("filters out excluded bot check runs", async () => {
      const octokit = makeMockOctokit(
        [
          {
            id: 1,
            name: "Vercel Preview",
            status: "completed",
            conclusion: "success",
            app: { slug: "vercel" },
            details_url: null,
          },
          {
            id: 2,
            name: "CI Build",
            status: "completed",
            conclusion: "success",
            app: { slug: "github-actions" },
            details_url: null,
          },
          {
            id: 3,
            name: "Code Review",
            status: "completed",
            conclusion: "success",
            app: { slug: "kody-ai" },
            details_url: null,
          },
        ],
        [],
      );

      const result = await fetchAiCheckRuns(octokit as never, "o", "r", "abc123");

      assert.equal(result.length, 1);
      assert.equal(result[0]!.appSlug, "kody-ai");
    });

    it("filters out check runs with no app field", async () => {
      const octokit = makeMockOctokit(
        [
          {
            id: 1,
            name: "Mystery Check",
            status: "completed",
            conclusion: "success",
            app: null,
            details_url: null,
          },
        ],
        [],
      );

      const result = await fetchAiCheckRuns(octokit as never, "o", "r", "abc123");

      assert.equal(result.length, 0);
    });

    it("maps fields correctly", async () => {
      const octokit = makeMockOctokit(
        [
          {
            id: 42,
            name: "AI Review",
            status: "in_progress",
            conclusion: null,
            app: { slug: "coderabbitai" },
            details_url: "https://example.com/details",
          },
        ],
        [],
      );

      const result = await fetchAiCheckRuns(octokit as never, "o", "r", "abc123");

      assert.equal(result[0]!.id, 42);
      assert.equal(result[0]!.name, "AI Review");
      assert.equal(result[0]!.status, "in_progress");
      assert.equal(result[0]!.conclusion, null);
      assert.equal(result[0]!.appSlug, "coderabbitai");
      assert.equal(result[0]!.detailsUrl, "https://example.com/details");
      assert.equal(result[0]!.source, "check_run");
    });
  });

  describe("commit status filtering", () => {
    it("includes AI review bot commit statuses", async () => {
      const octokit = makeMockOctokit([], [
        {
          id: 10,
          context: "CodeRabbit",
          state: "success",
          target_url: "https://coderabbit.ai",
          creator: { login: "coderabbitai[bot]" },
        },
      ]);

      const result = await fetchAiCheckRuns(octokit as never, "o", "r", "abc123");

      assert.equal(result.length, 1);
      assert.equal(result[0]!.name, "CodeRabbit");
      assert.equal(result[0]!.appSlug, "coderabbitai");
      assert.equal(result[0]!.status, "completed");
      assert.equal(result[0]!.conclusion, "success");
      assert.equal(result[0]!.source, "commit_status");
    });

    it("filters out excluded bot commit statuses", async () => {
      const octokit = makeMockOctokit([], [
        {
          id: 10,
          context: "Vercel – billing",
          state: "success",
          target_url: null,
          creator: { login: "vercel[bot]" },
        },
        {
          id: 11,
          context: "CodeRabbit",
          state: "success",
          target_url: null,
          creator: { login: "coderabbitai[bot]" },
        },
      ]);

      const result = await fetchAiCheckRuns(octokit as never, "o", "r", "abc123");

      assert.equal(result.length, 1);
      assert.equal(result[0]!.appSlug, "coderabbitai");
    });

    it("filters out statuses with no creator", async () => {
      const octokit = makeMockOctokit([], [
        {
          id: 10,
          context: "Unknown",
          state: "success",
          target_url: null,
          creator: null,
        },
      ]);

      const result = await fetchAiCheckRuns(octokit as never, "o", "r", "abc123");

      assert.equal(result.length, 0);
    });

    it("deduplicates commit statuses by context (keeps first/latest)", async () => {
      const octokit = makeMockOctokit([], [
        {
          id: 11,
          context: "CodeRabbit",
          state: "success",
          target_url: null,
          creator: { login: "coderabbitai[bot]" },
        },
        {
          id: 10,
          context: "CodeRabbit",
          state: "pending",
          target_url: null,
          creator: { login: "coderabbitai[bot]" },
        },
      ]);

      const result = await fetchAiCheckRuns(octokit as never, "o", "r", "abc123");

      assert.equal(result.length, 1);
      assert.equal(result[0]!.conclusion, "success");
    });

    it("maps pending state to in_progress status", async () => {
      const octokit = makeMockOctokit([], [
        {
          id: 10,
          context: "CodeRabbit",
          state: "pending",
          target_url: null,
          creator: { login: "coderabbitai[bot]" },
        },
      ]);

      const result = await fetchAiCheckRuns(octokit as never, "o", "r", "abc123");

      assert.equal(result[0]!.status, "in_progress");
      assert.equal(result[0]!.conclusion, null);
    });

    it("maps failure/error states to completed with failure conclusion", async () => {
      const octokit = makeMockOctokit([], [
        {
          id: 10,
          context: "CodeRabbit",
          state: "failure",
          target_url: null,
          creator: { login: "coderabbitai[bot]" },
        },
        {
          id: 11,
          context: "Kody",
          state: "error",
          target_url: null,
          creator: { login: "kody-ai[bot]" },
        },
      ]);

      const result = await fetchAiCheckRuns(octokit as never, "o", "r", "abc123");

      assert.equal(result[0]!.status, "completed");
      assert.equal(result[0]!.conclusion, "failure");
      assert.equal(result[1]!.status, "completed");
      assert.equal(result[1]!.conclusion, "failure");
    });
  });

  describe("combined results", () => {
    it("merges check runs and commit statuses", async () => {
      const octokit = makeMockOctokit(
        [
          {
            id: 1,
            name: "Code Review Failed",
            status: "completed",
            conclusion: "failure",
            app: { slug: "kody-ai" },
            details_url: null,
          },
        ],
        [
          {
            id: 10,
            context: "CodeRabbit",
            state: "success",
            target_url: null,
            creator: { login: "coderabbitai[bot]" },
          },
        ],
      );

      const result = await fetchAiCheckRuns(octokit as never, "o", "r", "abc123");

      assert.equal(result.length, 2);
      assert.equal(result[0]!.source, "check_run");
      assert.equal(result[1]!.source, "commit_status");
    });
  });

  describe("Copilot Agent job matching", () => {
    const copilotDetailsUrl = "https://github.com/o/r/actions/runs/555/job/777";

    it("includes Agent job when workflow path matches", async () => {
      const octokit = makeMockOctokit(
        [
          {
            id: 777,
            name: "Agent",
            status: "in_progress",
            conclusion: null,
            app: { slug: "github-actions" },
            details_url: copilotDetailsUrl,
          },
        ],
        [],
        { 555: { path: "dynamic/copilot-pull-request-reviewer" } },
      );

      const result = await fetchAiCheckRuns(octokit as never, "o", "r", "sha");

      assert.equal(result.length, 1);
      assert.equal(result[0]!.name, "Copilot");
      assert.equal(result[0]!.appSlug, "copilot-pull-request-reviewer");
      assert.equal(result[0]!.status, "in_progress");
    });

    it("excludes Agent job when workflow path does not match", async () => {
      const octokit = makeMockOctokit(
        [
          {
            id: 777,
            name: "Agent",
            status: "completed",
            conclusion: "success",
            app: { slug: "github-actions" },
            details_url: "https://github.com/o/r/actions/runs/999/job/777",
          },
        ],
        [],
        { 999: { path: ".github/workflows/other.yml" } },
      );

      const result = await fetchAiCheckRuns(octokit as never, "o", "r", "sha");

      assert.equal(result.length, 0);
    });

    it("excludes Agent job when getWorkflowRun 404s", async () => {
      const octokit = makeMockOctokit(
        [
          {
            id: 777,
            name: "Agent",
            status: "completed",
            conclusion: "success",
            app: { slug: "github-actions" },
            details_url: copilotDetailsUrl,
          },
        ],
        [],
        {},
      );

      const result = await fetchAiCheckRuns(octokit as never, "o", "r", "sha");

      assert.equal(result.length, 0);
    });

    it("excludes Agent job when details_url is missing or malformed", async () => {
      const octokit = makeMockOctokit(
        [
          {
            id: 777,
            name: "Agent",
            status: "completed",
            conclusion: "success",
            app: { slug: "github-actions" },
            details_url: null,
          },
        ],
        [],
        {},
      );

      const result = await fetchAiCheckRuns(octokit as never, "o", "r", "sha");
      assert.equal(result.length, 0);
    });

    it("normalizes Copilot Agent failure to neutral", async () => {
      const octokit = makeMockOctokit(
        [
          {
            id: 777,
            name: "Agent",
            status: "completed",
            conclusion: "failure",
            app: { slug: "github-actions" },
            details_url: copilotDetailsUrl,
          },
        ],
        [],
        { 555: { path: "dynamic/copilot-pull-request-reviewer" } },
      );

      const result = await fetchAiCheckRuns(octokit as never, "o", "r", "sha");

      assert.equal(result.length, 1);
      assert.equal(result[0]!.conclusion, "neutral");
      assert.equal(isFailedCheck(result[0]!), false);
    });

    it("caches workflow-run lookups per run_id", async () => {
      const octokit = makeMockOctokit(
        [
          {
            id: 777,
            name: "Agent",
            status: "in_progress",
            conclusion: null,
            app: { slug: "github-actions" },
            details_url: "https://github.com/o/r/actions/runs/555/job/777",
          },
          {
            id: 778,
            name: "Agent",
            status: "in_progress",
            conclusion: null,
            app: { slug: "github-actions" },
            details_url: "https://github.com/o/r/actions/runs/555/job/778",
          },
        ],
        [],
        { 555: { path: "dynamic/copilot-pull-request-reviewer" } },
      );

      const result = await fetchAiCheckRuns(octokit as never, "o", "r", "sha");

      assert.equal(result.length, 2);
      assert.equal(octokit.actions.getWorkflowRun.mock.calls.length, 1);
    });

    it("does not double-count an Agent job already matched via AI_REVIEWERS", async () => {
      const octokit = makeMockOctokit(
        [
          {
            id: 777,
            name: "Agent",
            status: "completed",
            conclusion: "success",
            app: { slug: "copilot-pull-request-reviewer" },
            details_url: null,
          },
        ],
        [],
        {},
      );

      const result = await fetchAiCheckRuns(octokit as never, "o", "r", "sha");
      assert.equal(result.length, 1);
      assert.equal(result[0]!.appSlug, "copilot-pull-request-reviewer");
      assert.equal(result[0]!.name, "Agent");
    });
  });
});

describe("extractRunIdFromDetailsUrl", () => {
  it("parses a valid github-actions details_url", () => {
    const url = "https://github.com/owner/repo/actions/runs/12345/job/67890";
    assert.equal(extractRunIdFromDetailsUrl(url), 12345);
  });

  it("returns null for null/undefined/empty", () => {
    assert.equal(extractRunIdFromDetailsUrl(null), null);
    assert.equal(extractRunIdFromDetailsUrl(undefined), null);
    assert.equal(extractRunIdFromDetailsUrl(""), null);
  });

  it("returns null for non-matching urls", () => {
    assert.equal(extractRunIdFromDetailsUrl("https://coderabbit.ai/review/42"), null);
    assert.equal(extractRunIdFromDetailsUrl("https://github.com/owner/repo/pull/7"), null);
  });
});

// ---------------------------------------------------------------------------
// Status computation (mirrors getCheckStatus logic)
// ---------------------------------------------------------------------------

describe("status computation", () => {
  it("allCompleted is true when all checks have status completed", () => {
    const checks: AiCheckRun[] = [
      { id: 1, name: "A", status: "completed", conclusion: "success", appSlug: "a", detailsUrl: null, source: "check_run" },
      { id: 2, name: "B", status: "completed", conclusion: "success", appSlug: "b", detailsUrl: null, source: "commit_status" },
    ];

    const { allCompleted, anyFailed } = computeStatus(checks);

    assert.equal(allCompleted, true);
    assert.equal(anyFailed, false);
  });

  it("allCompleted is false when any check is in_progress", () => {
    const checks: AiCheckRun[] = [
      { id: 1, name: "A", status: "completed", conclusion: "success", appSlug: "a", detailsUrl: null, source: "check_run" },
      { id: 2, name: "B", status: "in_progress", conclusion: null, appSlug: "b", detailsUrl: null, source: "commit_status" },
    ];

    const { allCompleted } = computeStatus(checks);

    assert.equal(allCompleted, false);
  });

  it("allCompleted is false when any check is queued", () => {
    const checks: AiCheckRun[] = [
      { id: 1, name: "A", status: "queued", conclusion: null, appSlug: "a", detailsUrl: null, source: "check_run" },
    ];

    const { allCompleted } = computeStatus(checks);

    assert.equal(allCompleted, false);
  });

  it("anyFailed is true when a completed check has non-success/neutral conclusion", () => {
    const checks: AiCheckRun[] = [
      { id: 1, name: "A", status: "completed", conclusion: "failure", appSlug: "a", detailsUrl: null, source: "check_run" },
      { id: 2, name: "B", status: "completed", conclusion: "success", appSlug: "b", detailsUrl: null, source: "commit_status" },
    ];

    const { anyFailed } = computeStatus(checks);

    assert.equal(anyFailed, true);
  });

  it("anyFailed is false when conclusion is neutral", () => {
    const checks: AiCheckRun[] = [
      { id: 1, name: "A", status: "completed", conclusion: "neutral", appSlug: "a", detailsUrl: null, source: "check_run" },
    ];

    const { anyFailed } = computeStatus(checks);

    assert.equal(anyFailed, false);
  });

  it("anyFailed is false when conclusion is skipped", () => {
    const checks: AiCheckRun[] = [
      { id: 1, name: "Code Review Skipped", status: "completed", conclusion: "skipped", appSlug: "kody-ai", detailsUrl: null, source: "check_run" },
    ];

    const { allCompleted, anyFailed } = computeStatus(checks);

    assert.equal(allCompleted, true);
    assert.equal(anyFailed, false);
  });

  it("anyFailed is false when mix of success and skipped", () => {
    const checks: AiCheckRun[] = [
      { id: 1, name: "CodeRabbit", status: "completed", conclusion: "success", appSlug: "coderabbitai", detailsUrl: null, source: "commit_status" },
      { id: 2, name: "Code Review Skipped", status: "completed", conclusion: "skipped", appSlug: "kody-ai", detailsUrl: null, source: "check_run" },
    ];

    const { allCompleted, anyFailed } = computeStatus(checks);

    assert.equal(allCompleted, true);
    assert.equal(anyFailed, false);
  });

  it("empty checks: allCompleted is true (no AI bots to wait for)", () => {
    const { allCompleted, anyFailed } = computeStatus([]);

    assert.equal(allCompleted, true);
    assert.equal(anyFailed, false);
  });
});

// ---------------------------------------------------------------------------
// rerunFailedChecks
// ---------------------------------------------------------------------------

describe("rerunFailedChecks", () => {
  it("only re-requests check_run sources that failed", async () => {
    const octokit = makeMockOctokit();
    const checks: AiCheckRun[] = [
      { id: 1, name: "Failed Run", status: "completed", conclusion: "failure", appSlug: "kody-ai", detailsUrl: null, source: "check_run" },
      { id: 2, name: "Success Run", status: "completed", conclusion: "success", appSlug: "other-ai", detailsUrl: null, source: "check_run" },
      { id: 3, name: "In Progress", status: "in_progress", conclusion: null, appSlug: "another-ai", detailsUrl: null, source: "check_run" },
    ];

    await rerunFailedChecks(octokit as never, "o", "r", checks);

    assert.equal(octokit.checks.rerequestRun.mock.calls.length, 1);
    const call = octokit.checks.rerequestRun.mock.calls[0]!.arguments[0] as { check_run_id: number };
    assert.equal(call.check_run_id, 1);
  });

  it("skips commit_status sources (cannot be re-requested)", async () => {
    const octokit = makeMockOctokit();
    const checks: AiCheckRun[] = [
      { id: 10, name: "CodeRabbit", status: "completed", conclusion: "failure", appSlug: "coderabbitai", detailsUrl: null, source: "commit_status" },
    ];

    await rerunFailedChecks(octokit as never, "o", "r", checks);

    assert.equal(octokit.checks.rerequestRun.mock.calls.length, 0);
  });

  it("handles 404 gracefully for third-party App check runs", async () => {
    const octokit = makeMockOctokit();
    octokit.checks.rerequestRun = mock.fn(async () => {
      const err = new Error("Not Found") as Error & { status: number };
      err.status = 404;
      throw err;
    });
    const checks: AiCheckRun[] = [
      { id: 1, name: "Kody Review", status: "completed", conclusion: "failure", appSlug: "kody-ai", detailsUrl: null, source: "check_run" },
    ];

    // Should not throw
    await rerunFailedChecks(octokit as never, "o", "r", checks);

    assert.equal(octokit.checks.rerequestRun.mock.calls.length, 1);
  });

  it("handles 403 gracefully for third-party App check runs", async () => {
    const octokit = makeMockOctokit();
    octokit.checks.rerequestRun = mock.fn(async () => {
      const err = new Error("Forbidden") as Error & { status: number };
      err.status = 403;
      throw err;
    });
    const checks: AiCheckRun[] = [
      { id: 1, name: "Kody Review", status: "completed", conclusion: "failure", appSlug: "kody-ai", detailsUrl: null, source: "check_run" },
    ];

    await rerunFailedChecks(octokit as never, "o", "r", checks);

    assert.equal(octokit.checks.rerequestRun.mock.calls.length, 1);
  });

  it("rethrows unexpected errors", async () => {
    const octokit = makeMockOctokit();
    octokit.checks.rerequestRun = mock.fn(async () => {
      const err = new Error("Server Error") as Error & { status: number };
      err.status = 500;
      throw err;
    });
    const checks: AiCheckRun[] = [
      { id: 1, name: "Broken", status: "completed", conclusion: "failure", appSlug: "some-ai", detailsUrl: null, source: "check_run" },
    ];

    await assert.rejects(
      () => rerunFailedChecks(octokit as never, "o", "r", checks),
      { status: 500 },
    );
  });

  it("does not re-run skipped checks", async () => {
    const octokit = makeMockOctokit();
    const checks: AiCheckRun[] = [
      { id: 1, name: "Code Review Skipped", status: "completed", conclusion: "skipped", appSlug: "kody-ai", detailsUrl: null, source: "check_run" },
      { id: 2, name: "CodeRabbit", status: "completed", conclusion: "success", appSlug: "coderabbitai", detailsUrl: null, source: "commit_status" },
    ];

    await rerunFailedChecks(octokit as never, "o", "r", checks);

    assert.equal(octokit.checks.rerequestRun.mock.calls.length, 0);
  });

  it("does nothing when no checks have failed", async () => {
    const octokit = makeMockOctokit();
    const checks: AiCheckRun[] = [
      { id: 1, name: "A", status: "completed", conclusion: "success", appSlug: "a", detailsUrl: null, source: "check_run" },
      { id: 2, name: "B", status: "in_progress", conclusion: null, appSlug: "b", detailsUrl: null, source: "check_run" },
    ];

    await rerunFailedChecks(octokit as never, "o", "r", checks);

    assert.equal(octokit.checks.rerequestRun.mock.calls.length, 0);
  });
});

// ---------------------------------------------------------------------------
// getCheckStatus — cachedSha parameter
// ---------------------------------------------------------------------------

describe("getCheckStatus", () => {
  it("uses cachedSha instead of calling getHeadSha", async () => {
    const octokit = makeMockOctokit(
      [
        {
          id: 1,
          name: "Code Review",
          status: "completed",
          conclusion: "success",
          app: { slug: "coderabbitai" },
          details_url: null,
        },
      ],
      [],
    );

    // If cachedSha were not used, this would crash trying to shell out to `gh`
    const result = await getCheckStatus(octokit as never, "o", "r", 1, "abc123");

    assert.equal(result.headSha, "abc123");
    assert.equal(result.prNumber, 1);
  });

  it("returns allCompleted true when all checks are completed", async () => {
    const octokit = makeMockOctokit(
      [
        {
          id: 1,
          name: "Code Review",
          status: "completed",
          conclusion: "success",
          app: { slug: "coderabbitai" },
          details_url: null,
        },
      ],
      [],
    );

    const result = await getCheckStatus(octokit as never, "o", "r", 1, "sha1");

    assert.equal(result.allCompleted, true);
    assert.equal(result.anyFailed, false);
  });

  it("returns allCompleted false when checks are still running", async () => {
    const octokit = makeMockOctokit(
      [
        {
          id: 1,
          name: "Code Review",
          status: "in_progress",
          conclusion: null,
          app: { slug: "coderabbitai" },
          details_url: null,
        },
      ],
      [],
    );

    const result = await getCheckStatus(octokit as never, "o", "r", 1, "sha1");

    assert.equal(result.allCompleted, false);
    assert.equal(result.anyFailed, false);
  });

  it("returns anyFailed true when a check has failed", async () => {
    const octokit = makeMockOctokit(
      [
        {
          id: 1,
          name: "Code Review",
          status: "completed",
          conclusion: "failure",
          app: { slug: "kody-ai" },
          details_url: null,
        },
      ],
      [],
    );

    const result = await getCheckStatus(octokit as never, "o", "r", 1, "sha1");

    assert.equal(result.allCompleted, true);
    assert.equal(result.anyFailed, true);
  });

  it("treats skipped conclusion as non-failure", async () => {
    const octokit = makeMockOctokit(
      [
        {
          id: 1,
          name: "Code Review Skipped",
          status: "completed",
          conclusion: "skipped",
          app: { slug: "kody-ai" },
          details_url: null,
        },
        {
          id: 2,
          name: "CodeRabbit",
          status: "completed",
          conclusion: "success",
          app: { slug: "coderabbitai" },
          details_url: null,
        },
      ],
      [],
    );

    const result = await getCheckStatus(octokit as never, "o", "r", 1, "sha1");

    assert.equal(result.allCompleted, true);
    assert.equal(result.anyFailed, false);
  });

  it("passes cachedSha to fetchAiCheckRuns as the ref", async () => {
    const octokit = makeMockOctokit([], []);

    const result = await getCheckStatus(octokit as never, "o", "r", 1, "deadbeef");

    assert.equal(result.headSha, "deadbeef");
    // Verify paginate was called (meaning fetchAiCheckRuns ran with our ref)
    assert.equal(octokit.paginate.mock.calls.length, 2);
  });

  it("synthesizes a queued entry for an AI bot in requested_reviewers without a check run", async () => {
    const octokit = makeMockOctokit(
      [],
      [],
      {},
      [{ login: "Copilot", id: 175728472 }],
    );

    const result = await getCheckStatus(octokit as never, "o", "r", 311, "sha1");

    assert.equal(result.checks.length, 1);
    assert.equal(result.checks[0]!.name, "Copilot");
    assert.equal(result.checks[0]!.appSlug, "copilot-pull-request-reviewer");
    assert.equal(result.checks[0]!.status, "queued");
    assert.equal(result.allCompleted, false);
  });

  it("does not double-count when a requested bot already has a real check run", async () => {
    const octokit = makeMockOctokit(
      [
        {
          id: 777,
          name: "Agent",
          status: "in_progress",
          conclusion: null,
          app: { slug: "github-actions" },
          details_url: "https://github.com/o/r/actions/runs/555/job/777",
        },
      ],
      [],
      { 555: { path: "dynamic/copilot-pull-request-reviewer" } },
      [{ login: "Copilot", id: 175728472 }],
    );

    const result = await getCheckStatus(octokit as never, "o", "r", 311, "sha1");

    assert.equal(result.checks.length, 1);
    assert.equal(result.checks[0]!.appSlug, "copilot-pull-request-reviewer");
    assert.equal(result.checks[0]!.status, "in_progress");
    assert.equal(result.allCompleted, false);
  });

  it("ignores unknown logins in requested_reviewers", async () => {
    const octokit = makeMockOctokit(
      [],
      [],
      {},
      [
        { login: "some-human-reviewer", id: 1 },
        { login: "unknown-bot", id: 2 },
      ],
    );

    const result = await getCheckStatus(octokit as never, "o", "r", 311, "sha1");

    assert.equal(result.checks.length, 0);
    assert.equal(result.allCompleted, true);
  });
});

describe("fetchPendingAiReviewRequests", () => {
  it("returns an empty list when no reviewers are requested", async () => {
    const octokit = makeMockOctokit([], [], {}, []);

    const result = await fetchPendingAiReviewRequests(octokit as never, "o", "r", 1);

    assert.equal(result.length, 0);
  });

  it("returns a queued entry for Copilot", async () => {
    const octokit = makeMockOctokit(
      [],
      [],
      {},
      [{ login: "Copilot", id: 175728472 }],
    );

    const result = await fetchPendingAiReviewRequests(octokit as never, "o", "r", 1);

    assert.equal(result.length, 1);
    assert.equal(result[0]!.name, "Copilot");
    assert.equal(result[0]!.appSlug, "copilot-pull-request-reviewer");
    assert.equal(result[0]!.status, "queued");
    assert.equal(result[0]!.conclusion, null);
    assert.equal(result[0]!.source, "check_run");
    // Negative id to avoid collision with real check-run ids.
    assert.ok(result[0]!.id < 0);
  });

  it("filters out non-AI-bot logins", async () => {
    const octokit = makeMockOctokit(
      [],
      [],
      {},
      [
        { login: "some-human", id: 1 },
        { login: "Copilot", id: 175728472 },
        { login: "another-human", id: 3 },
      ],
    );

    const result = await fetchPendingAiReviewRequests(octokit as never, "o", "r", 1);

    assert.equal(result.length, 1);
    assert.equal(result[0]!.name, "Copilot");
  });
});
