import { describe, it, before, mock } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Mock child_process before importing the module under test
// ---------------------------------------------------------------------------

const execFileSyncMock = mock.fn((): string => "abc123\n");

mock.module("node:child_process", {
  namedExports: {
    execFileSync: execFileSyncMock,
  },
});

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
function makePollOctokit(sequence: MockCheckRun[][]) {
  let pollCount = 0;

  // Object.assign evaluates getters eagerly, so we must use defineProperty
  // to attach a dynamic _mockData getter to the mock function.
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

  return {
    checks: {
      listForRef,
      rerequestRun: mock.fn(async () => ({})),
    },
    repos: {
      listCommitStatusesForRef,
    },
    // Cache _mockData in a local variable so the getter is only invoked once.
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

type WaitFn = typeof import("../check-reviews.js").waitForCompletion;
type NoopFn = typeof import("../check-reviews-renderer.js").createNoopRenderer;
let waitForCompletion: WaitFn;
let createNoopRenderer: NoopFn;

describe("waitForCompletion", () => {
  before(async () => {
    const mod = await import("../check-reviews.js");
    const rendererMod = await import("../check-reviews-renderer.js");
    waitForCompletion = mod.waitForCompletion;
    createNoopRenderer = rendererMod.createNoopRenderer;
  });

  it("returns immediately when all checks are already complete", async () => {
    execFileSyncMock.mock.resetCalls();

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
    // getHeadSha called exactly once (the initial call)
    assert.equal(execFileSyncMock.mock.calls.length, 1);
  });

  it("fetches HEAD SHA only once across multiple polls", async () => {
    execFileSyncMock.mock.resetCalls();

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
    // getHeadSha (execFileSync) called only once — not on each poll
    assert.equal(execFileSyncMock.mock.calls.length, 1);
  });

  it("reuses the same headSha from the first poll in subsequent results", async () => {
    execFileSyncMock.mock.resetCalls();
    execFileSyncMock.mock.mockImplementation(() => "first-sha\n");

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

    // The final result should still have the SHA from the first call
    assert.equal(result.headSha, "first-sha");
  });
});
