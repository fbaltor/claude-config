import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import {
  extractFailedStepLog,
  buildCiFailureYaml,
  type CiFailure,
} from "../src/ci-checks.js";

// ---------------------------------------------------------------------------
// extractFailedStepLog
// ---------------------------------------------------------------------------

describe("extractFailedStepLog", () => {
  it("extracts the failed step section by name", () => {
    const log = [
      "2026-04-07T22:33:40.000Z ##[group]Setup",
      "2026-04-07T22:33:40.100Z setting up...",
      "2026-04-07T22:33:40.200Z ##[endgroup]",
      "2026-04-07T22:33:41.000Z ##[group]Lint",
      "2026-04-07T22:33:41.100Z Running eslint...",
      "2026-04-07T22:33:41.200Z src/foo.ts:5  error  'x' is unused",
      "2026-04-07T22:33:41.300Z ##[endgroup]",
      "2026-04-07T22:33:42.000Z ##[error]Process completed with exit code 1.",
    ].join("\n");

    const result = extractFailedStepLog(log, "Lint");

    assert.ok(result);
    assert.ok(result.includes("Running eslint..."));
    assert.ok(result.includes("src/foo.ts:5  error  'x' is unused"));
    // Should NOT include setup content
    assert.ok(!result.includes("setting up..."));
  });

  it("falls back to ##[error] lines when step name not found", () => {
    const log = [
      "2026-04-07T22:33:40.000Z some output",
      "2026-04-07T22:33:40.100Z ##[error]something broke",
      "2026-04-07T22:33:40.200Z ##[error]Process completed with exit code 1.",
    ].join("\n");

    const result = extractFailedStepLog(log, "NonexistentStep");

    assert.ok(result);
    assert.ok(result.includes("something broke"));
    // Should filter out "Process completed" noise
    assert.ok(!result.includes("Process completed"));
  });

  it("returns null when no errors found", () => {
    const log = "2026-04-07T22:33:40.000Z all good\n";
    const result = extractFailedStepLog(log, "Lint");
    assert.equal(result, null);
  });

  it("strips timestamps from output", () => {
    const log = [
      "2026-04-07T22:33:41.000Z ##[group]Build",
      "2026-04-07T22:33:41.100Z tsc --noEmit",
      "2026-04-07T22:33:41.200Z error TS2304: Cannot find name 'foo'",
      "2026-04-07T22:33:41.300Z ##[endgroup]",
    ].join("\n");

    const result = extractFailedStepLog(log, "Build");

    assert.ok(result);
    assert.ok(!result.includes("2026-04-07"));
    assert.ok(result.includes("tsc --noEmit"));
  });

  it("keeps only last 50 lines of a long step", () => {
    const lines = ["2026-04-07T22:33:41.000Z ##[group]Lint"];
    for (let i = 0; i < 100; i++) {
      lines.push(`2026-04-07T22:33:41.${String(i).padStart(3, "0")}Z line ${i}`);
    }
    lines.push("2026-04-07T22:33:42.000Z ##[endgroup]");
    const log = lines.join("\n");

    const result = extractFailedStepLog(log, "Lint");

    assert.ok(result);
    const resultLines = result.split("\n");
    assert.ok(resultLines.length <= 50);
    // Should contain the last lines, not the first
    assert.ok(result.includes("line 99"));
    assert.ok(!result.includes("line 0"));
  });

  it("works with null step name (error-line fallback)", () => {
    const log = [
      "2026-04-07T22:33:40.000Z output",
      "2026-04-07T22:33:40.100Z ##[error]build failed",
    ].join("\n");

    const result = extractFailedStepLog(log, null);

    assert.ok(result);
    assert.ok(result.includes("build failed"));
  });
});

// ---------------------------------------------------------------------------
// buildCiFailureYaml
// ---------------------------------------------------------------------------

describe("buildCiFailureYaml", () => {
  it("produces valid YAML with schema field", () => {
    const failures: CiFailure[] = [
      {
        job_name: "Lint, Type-check & Build",
        job_id: 123,
        workflow_name: "CI",
        url: "https://github.com/org/repo/actions/runs/1/job/123",
        sha: "abc1234",
        duration_seconds: 45,
        failed_step: "Lint",
        steps: [
          { name: "Checkout", conclusion: "success" },
          { name: "Lint", conclusion: "failure" },
          { name: "Build", conclusion: "skipped" },
        ],
        annotations: [
          {
            level: "warning",
            file: "src/foo.ts",
            line: 5,
            end_line: 5,
            message: "'x' is defined but never used",
          },
        ],
        log_excerpt: "src/foo.ts:5  error  'x' is unused",
      },
    ];

    const yaml = buildCiFailureYaml(failures);

    assert.ok(yaml.includes("schema: ci-failure-report"));
    assert.ok(yaml.includes("job_name: Lint, Type-check & Build"));
    assert.ok(yaml.includes("failed_step: Lint"));
    assert.ok(yaml.includes("src/foo.ts"));
    assert.ok(yaml.includes("'x' is defined but never used"));
  });

  it("handles multiple failures", () => {
    const failures: CiFailure[] = [
      {
        job_name: "Lint",
        job_id: 1,
        workflow_name: null,
        url: "",
        sha: "abc",
        duration_seconds: 10,
        failed_step: "Lint",
        steps: [],
        annotations: [],
        log_excerpt: null,
      },
      {
        job_name: "Test",
        job_id: 2,
        workflow_name: null,
        url: "",
        sha: "abc",
        duration_seconds: 30,
        failed_step: "Run tests",
        steps: [],
        annotations: [],
        log_excerpt: null,
      },
    ];

    const yaml = buildCiFailureYaml(failures);

    assert.ok(yaml.includes("job_name: Lint"));
    assert.ok(yaml.includes("job_name: Test"));
  });

  it("handles null fields gracefully", () => {
    const failures: CiFailure[] = [
      {
        job_name: "Build",
        job_id: 1,
        workflow_name: null,
        url: "",
        sha: "abc",
        duration_seconds: null,
        failed_step: null,
        steps: [],
        annotations: [],
        log_excerpt: null,
      },
    ];

    const yaml = buildCiFailureYaml(failures);

    assert.ok(yaml.includes("schema: ci-failure-report"));
    assert.ok(yaml.includes("job_name: Build"));
    assert.ok(yaml.includes("failed_step: null"));
  });
});

// ---------------------------------------------------------------------------
// fetchFailedCiChecks (mock-based)
// ---------------------------------------------------------------------------

describe("fetchFailedCiChecks", () => {
  // Lazy import to avoid hoisting issues
  let fetchFailedCiChecks: typeof import("../src/ci-checks.js").fetchFailedCiChecks;

  it("filters out AI reviewer checks and returns only failed CI checks", async () => {
    const mod = await import("../src/ci-checks.js");
    fetchFailedCiChecks = mod.fetchFailedCiChecks;

    const mockOctokit = {
      paginate: mock.fn(async () => [
        // AI bot — should be excluded
        { id: 1, name: "CodeRabbit", status: "completed", conclusion: "success", app: { slug: "coderabbitai" }, details_url: null },
        // Successful CI — should be excluded
        { id: 2, name: "Build", status: "completed", conclusion: "success", app: { slug: "github-actions" }, details_url: "https://example.com" },
        // Failed CI — should be included
        { id: 3, name: "Lint", status: "completed", conclusion: "failure", app: { slug: "github-actions" }, details_url: "https://example.com/3" },
        // In progress — should be excluded
        { id: 4, name: "Test", status: "in_progress", conclusion: null, app: { slug: "github-actions" }, details_url: null },
        // Cancelled — should be excluded
        { id: 5, name: "Deploy", status: "completed", conclusion: "cancelled", app: { slug: "github-actions" }, details_url: null },
        // Skipped — should be excluded
        { id: 6, name: "E2E", status: "completed", conclusion: "skipped", app: { slug: "github-actions" }, details_url: null },
        // Ignored CI check name (Copilot's Agent job) — should be excluded
        { id: 7, name: "Agent", status: "completed", conclusion: "failure", app: { slug: "github-actions" }, details_url: "https://example.com/7" },
      ]),
      checks: {
        listForRef: mock.fn(),
      },
    };

    const result = await fetchFailedCiChecks(
      mockOctokit as never,
      "owner",
      "repo",
      "abc123",
    );

    assert.equal(result.length, 1);
    assert.equal(result[0].id, 3);
    assert.equal(result[0].name, "Lint");
    assert.equal(result[0].appSlug, "github-actions");
  });

  it("returns empty array when no CI failures", async () => {
    const mod = await import("../src/ci-checks.js");
    fetchFailedCiChecks = mod.fetchFailedCiChecks;

    const mockOctokit = {
      paginate: mock.fn(async () => [
        { id: 1, name: "Build", status: "completed", conclusion: "success", app: { slug: "github-actions" }, details_url: null },
      ]),
      checks: {
        listForRef: mock.fn(),
      },
    };

    const result = await fetchFailedCiChecks(
      mockOctokit as never,
      "owner",
      "repo",
      "abc123",
    );

    assert.equal(result.length, 0);
  });
});
