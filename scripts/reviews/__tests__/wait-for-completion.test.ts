import { describe, it, before, mock } from "node:test";
import assert from "node:assert/strict";

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

interface MockOptions {
  /** SHA returned by pulls.get. Defaults to "abc123". */
  headSha?: string;
  /**
   * Per-poll requested-reviewers sequence. Defaults to always empty.
   * Indexed independently of the check-run sequence; runs out of bounds
   * use the last entry.
   */
  reviewerSequence?: MockRequestedReviewer[][];
  /**
   * Workflow runs keyed by `run_id`. Required when the check-run sequence
   * includes Copilot `Agent` jobs (app.slug = "github-actions"), since
   * `fetchAiCheckRuns` resolves their workflow path via getWorkflowRun.
   */
  workflowRunsByRunId?: Record<number, { path: string }>;
}

/**
 * Creates a mock Octokit that returns successive check run arrays on each
 * getCheckStatus poll. Each paginate call for check runs advances the index.
 */
function makePollOctokit(sequence: MockCheckRun[][], options: MockOptions | string = {}) {
  // Backwards-compat: older callers pass a SHA string as the second arg.
  const opts: MockOptions = typeof options === "string" ? { headSha: options } : options;
  const headSha = opts.headSha ?? "abc123";
  const reviewerSequence = opts.reviewerSequence ?? [[]];
  const workflowRunsByRunId = opts.workflowRunsByRunId ?? {};
  let pollCount = 0;
  let reviewerCallCount = 0;

  const listForRef = mock.fn(async () => ({ data: { check_runs: [] } }));
  Object.defineProperty(listForRef, "_mockData", {
    get() {
      return sequence[Math.min(pollCount++, sequence.length - 1)]!;
    },
    enumerable: true,
  });

  const listCommitStatusesForRef = mock.fn(async () => ({ data: [] }));
  Object.defineProperty(listCommitStatusesForRef, "_mockData", {
    value: [] as MockCommitStatus[],
    enumerable: true,
  });

  const pullsGet = mock.fn(async () => ({
    data: { head: { sha: headSha } },
  }));

  const listRequestedReviewers = mock.fn(async () => {
    const idx = Math.min(reviewerCallCount++, reviewerSequence.length - 1);
    return { data: { users: reviewerSequence[idx]!, teams: [] } };
  });

  const getWorkflowRun = mock.fn(async ({ run_id }: { run_id: number }) => {
    const wf = workflowRunsByRunId[run_id];
    if (!wf) {
      const err = new Error("Not Found") as Error & { status: number };
      err.status = 404;
      throw err;
    }
    return { data: wf };
  });

  return {
    pulls: { get: pullsGet, listRequestedReviewers },
    checks: {
      listForRef,
      rerequestRun: mock.fn(async () => ({})),
    },
    repos: {
      listCommitStatusesForRef,
    },
    actions: {
      getWorkflowRun,
    },
    paginate: mock.fn(async (method: unknown) => {
      const fn = method as { _mockData?: unknown[] };
      const data = fn._mockData;
      if (data !== undefined) return data;
      const response = await (method as () => Promise<{ data: unknown }>)();
      return response.data;
    }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

type WaitFn = typeof import("../src/check-reviews.js").waitForCompletion;
type NoopFn = typeof import("../src/check-reviews-renderer.js").createNoopRenderer;
let waitForCompletion: WaitFn;
let createNoopRenderer: NoopFn;

describe("waitForCompletion", () => {
  before(async () => {
    const mod = await import("../src/check-reviews.js");
    const rendererMod = await import("../src/check-reviews-renderer.js");
    waitForCompletion = mod.waitForCompletion;
    createNoopRenderer = rendererMod.createNoopRenderer;
  });

  it("returns immediately when all checks are already complete", async () => {
    const completed: MockCheckRun = {
      id: 1,
      name: "CodeRabbit",
      status: "completed",
      conclusion: "success",
      app: { slug: "coderabbitai" },
      details_url: null,
    };

    const octokit = makePollOctokit([[completed]]);

    const result = await waitForCompletion(octokit as never, "o", "r", 1, {
      pollIntervalMs: 10,
      timeoutMs: 100,
      renderer: createNoopRenderer(),
    });

    assert.equal(result.allCompleted, true);
    assert.equal(result.anyFailed, false);
    // pulls.get called exactly once (the initial call)
    assert.equal(octokit.pulls.get.mock.calls.length, 1);
  });

  it("fetches HEAD SHA only once across multiple polls", async () => {
    const inProgress: MockCheckRun = {
      id: 1,
      name: "CodeRabbit",
      status: "in_progress",
      conclusion: null,
      app: { slug: "coderabbitai" },
      details_url: null,
    };
    const completed: MockCheckRun = {
      id: 1,
      name: "CodeRabbit",
      status: "completed",
      conclusion: "success",
      app: { slug: "coderabbitai" },
      details_url: null,
    };

    const octokit = makePollOctokit([[inProgress], [completed]]);

    const result = await waitForCompletion(octokit as never, "o", "r", 1, {
      pollIntervalMs: 10,
      timeoutMs: 5000,
      renderer: createNoopRenderer(),
    });

    assert.equal(result.allCompleted, true);
    // pulls.get called only once — not on each poll
    assert.equal(octokit.pulls.get.mock.calls.length, 1);
  });

  it("reuses the same headSha from the first poll in subsequent results", async () => {
    const inProgress: MockCheckRun = {
      id: 1,
      name: "CodeRabbit",
      status: "in_progress",
      conclusion: null,
      app: { slug: "coderabbitai" },
      details_url: null,
    };
    const completed: MockCheckRun = {
      id: 1,
      name: "CodeRabbit",
      status: "completed",
      conclusion: "success",
      app: { slug: "coderabbitai" },
      details_url: null,
    };

    const octokit = makePollOctokit([[inProgress], [completed]], "first-sha");

    const result = await waitForCompletion(octokit as never, "o", "r", 1, {
      pollIntervalMs: 10,
      timeoutMs: 5000,
      renderer: createNoopRenderer(),
    });

    // The final result should still have the SHA from the first call
    assert.equal(result.headSha, "first-sha");
  });

  it("does not return early while Copilot is still in requested_reviewers (re-review case)", async () => {
    // Live shape from PR #313: two completed Copilot Agent runs on the HEAD
    // SHA, but Copilot is still listed as a requested reviewer because the
    // re-requested review body has not been posted yet. waitForCompletion
    // must keep polling until requested_reviewers no longer lists Copilot.
    const completedAgent1: MockCheckRun = {
      id: 72803193065,
      name: "Agent",
      status: "completed",
      conclusion: "success",
      app: { slug: "github-actions" },
      details_url: "https://github.com/o/r/actions/runs/100/job/200",
    };
    const completedAgent2: MockCheckRun = {
      id: 72944877404,
      name: "Agent",
      status: "completed",
      conclusion: "success",
      app: { slug: "github-actions" },
      details_url: "https://github.com/o/r/actions/runs/101/job/201",
    };
    const checks = [completedAgent1, completedAgent2];

    const octokit = makePollOctokit([checks, checks], {
      reviewerSequence: [
        [{ login: "Copilot", id: 198982749 }], // first poll: still pending
        [], // second poll: Copilot has now submitted the new review
      ],
      workflowRunsByRunId: {
        100: { path: "dynamic/copilot-pull-request-reviewer" },
        101: { path: "dynamic/copilot-pull-request-reviewer" },
      },
    });

    const result = await waitForCompletion(octokit as never, "o", "r", 313, {
      pollIntervalMs: 10,
      timeoutMs: 5000,
      renderer: createNoopRenderer(),
    });

    assert.equal(result.allCompleted, true);
    // Polled at least twice — once initially, once more after seeing the
    // pending reviewer. Proves the wait did not return on the first poll.
    assert.ok(
      octokit.pulls.listRequestedReviewers.mock.calls.length >= 2,
      `expected listRequestedReviewers to be called at least twice, got ${octokit.pulls.listRequestedReviewers.mock.calls.length}`,
    );
  });
});
