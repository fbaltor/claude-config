import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  checkIcon,
  checkLabel,
  formatCheckLine,
  summaryText,
} from "../check-reviews-renderer.js";
import type { AiCheckRun, CheckStatusResult } from "../check-reviews.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCheck(overrides: Partial<AiCheckRun> = {}): AiCheckRun {
  return {
    id: 1,
    name: "Test Check",
    status: "completed",
    conclusion: "success",
    appSlug: "test-bot",
    detailsUrl: null,
    source: "check_run",
    ...overrides,
  };
}

function makeResult(
  overrides: Partial<CheckStatusResult> = {},
): CheckStatusResult {
  return {
    prNumber: 1,
    headSha: "abc1234567890",
    checks: [],
    allCompleted: true,
    anyFailed: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// checkIcon
// ---------------------------------------------------------------------------

describe("checkIcon", () => {
  it("cycles through spinner frames for in-progress checks", () => {
    const check = makeCheck({ status: "in_progress", conclusion: null });
    assert.equal(checkIcon(check, 0, false), "◐");
    assert.equal(checkIcon(check, 1, false), "◓");
    assert.equal(checkIcon(check, 2, false), "◑");
    assert.equal(checkIcon(check, 3, false), "◒");
    assert.equal(checkIcon(check, 4, false), "◐"); // wraps around
  });

  it("returns ✓ for success", () => {
    assert.equal(checkIcon(makeCheck({ conclusion: "success" }), 0, false), "✓");
  });

  it("returns ⊘ for skipped", () => {
    assert.equal(checkIcon(makeCheck({ conclusion: "skipped" }), 0, false), "⊘");
  });

  it("returns ◦ for neutral", () => {
    assert.equal(checkIcon(makeCheck({ conclusion: "neutral" }), 0, false), "◦");
  });

  it("returns ✗ for failure", () => {
    assert.equal(checkIcon(makeCheck({ conclusion: "failure" }), 0, false), "✗");
  });

  it("returns ✗ for other conclusions (cancelled, timed_out)", () => {
    assert.equal(checkIcon(makeCheck({ conclusion: "cancelled" }), 0, false), "✗");
    assert.equal(checkIcon(makeCheck({ conclusion: "timed_out" }), 0, false), "✗");
  });
});

// ---------------------------------------------------------------------------
// checkLabel
// ---------------------------------------------------------------------------

describe("checkLabel", () => {
  it("returns 'in progress' for non-completed status", () => {
    assert.equal(
      checkLabel(makeCheck({ status: "in_progress", conclusion: null }), false),
      "in progress",
    );
    assert.equal(
      checkLabel(makeCheck({ status: "queued", conclusion: null }), false),
      "in progress",
    );
  });

  it("returns 'completed' for success", () => {
    assert.equal(checkLabel(makeCheck({ conclusion: "success" }), false), "completed");
  });

  it("returns 'skipped' for skipped", () => {
    assert.equal(checkLabel(makeCheck({ conclusion: "skipped" }), false), "skipped");
  });

  it("returns 'neutral' for neutral", () => {
    assert.equal(checkLabel(makeCheck({ conclusion: "neutral" }), false), "neutral");
  });

  it("returns 'failed — <conclusion>' for failures", () => {
    assert.equal(checkLabel(makeCheck({ conclusion: "failure" }), false), "failed — failure");
    assert.equal(checkLabel(makeCheck({ conclusion: "cancelled" }), false), "failed — cancelled");
  });
});

// ---------------------------------------------------------------------------
// formatCheckLine
// ---------------------------------------------------------------------------

describe("formatCheckLine", () => {
  it("combines icon, padded name, and label", () => {
    const check = makeCheck({ name: "CodeRabbit", conclusion: "success" });
    const line = formatCheckLine(check, 0, false);
    assert.ok(line.includes("✓"));
    assert.ok(line.includes("CodeRabbit"));
    assert.ok(line.includes("completed"));
  });

  it("pads short names to align labels", () => {
    const line = formatCheckLine(makeCheck({ name: "A" }), 0, false);
    // Name is padded to 22 characters
    assert.ok(line.includes("A" + " ".repeat(21)));
  });

  it("shows spinner and 'in progress' for running checks", () => {
    const check = makeCheck({ name: "Review", status: "in_progress", conclusion: null });
    const line = formatCheckLine(check, 0, false);
    assert.ok(line.includes("◐"));
    assert.ok(line.includes("in progress"));
  });
});

// ---------------------------------------------------------------------------
// summaryText
// ---------------------------------------------------------------------------

describe("summaryText", () => {
  it("shows completion message when all passed", () => {
    const result = makeResult({
      checks: [makeCheck()],
      allCompleted: true,
      anyFailed: false,
    });
    assert.equal(summaryText(result, false), "✓ All AI reviews complete!");
  });

  it("shows failure count when some failed", () => {
    const result = makeResult({
      checks: [
        makeCheck({ conclusion: "failure" }),
        makeCheck({ conclusion: "success" }),
      ],
      allCompleted: true,
      anyFailed: true,
    });
    assert.equal(summaryText(result, false), "✗ 1 of 2 checks failed");
  });

  it("shows pending count when some still running", () => {
    const result = makeResult({
      checks: [
        makeCheck({ status: "in_progress", conclusion: null }),
        makeCheck({ conclusion: "success" }),
      ],
      allCompleted: false,
      anyFailed: false,
    });
    assert.equal(summaryText(result, false), "1 of 2 still running");
  });

  it("shows empty message when no checks found", () => {
    const result = makeResult({ checks: [] });
    assert.equal(summaryText(result, false), "No AI review checks found.");
  });

  it("does not count skipped as failed", () => {
    const result = makeResult({
      checks: [
        makeCheck({ conclusion: "skipped" }),
        makeCheck({ conclusion: "success" }),
      ],
      allCompleted: true,
      anyFailed: false,
    });
    assert.equal(summaryText(result, false), "✓ All AI reviews complete!");
  });

  it("does not count neutral as failed", () => {
    const result = makeResult({
      checks: [
        makeCheck({ conclusion: "neutral" }),
        makeCheck({ conclusion: "success" }),
      ],
      allCompleted: true,
      anyFailed: false,
    });
    assert.equal(summaryText(result, false), "✓ All AI reviews complete!");
  });

  it("counts only real failures", () => {
    const result = makeResult({
      checks: [
        makeCheck({ conclusion: "failure" }),
        makeCheck({ conclusion: "cancelled" }),
        makeCheck({ conclusion: "skipped" }),
        makeCheck({ conclusion: "success" }),
      ],
      allCompleted: true,
      anyFailed: true,
    });
    assert.equal(summaryText(result, false), "✗ 2 of 4 checks failed");
  });
});
