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

/**
 * Creates a mock Octokit that returns successive check run arrays on each
 * getCheckStatus poll. Each paginate call for check runs advances the index.
 */
function makePollOctokit(sequence: MockCheckRun[][], headSha = "abc123") {
  let pollCount = 0;

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

  return {
    pulls: { get: pullsGet },
    checks: {
      listForRef,
      rerequestRun: mock.fn(async () => ({})),
    },
    repos: {
      listCommitStatusesForRef,
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
});
