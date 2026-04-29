import { describe, it } from "node:test";
import assert from "node:assert/strict";
import yaml from "js-yaml";

import { buildYamlOutput, type BuildYamlInput } from "../src/yaml-builder/index.js";
import type { YamlDocument } from "../src/yaml-builder/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInput(overrides: Partial<BuildYamlInput> = {}): BuildYamlInput {
  return {
    pr: 1,
    owner: "test-org",
    repo: "test-repo",
    prMeta: {
      title: "Test PR",
      url: "https://github.com/test-org/test-repo/pull/1",
      author: "alice",
      baseRefName: "main",
      headRefName: "feature",
      createdAt: "2025-01-01T00:00:00Z",
      changedFiles: 1,
    },
    reviews: [],
    threads: [],
    comments: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildYamlOutput", () => {
  it("propagates ai_agent_prompt to exploded summary items", () => {
    const reviewBody = [
      "## `src/index.ts` [Major] Issues",
      "",
      "- **Missing null check** in handler",
      "",
      "<details>",
      "<summary>🤖 Prompt for AI Agents</summary>",
      "",
      "```",
      "Fix the null check in src/index.ts",
      "```",
      "",
      "</details>",
    ].join("\n");

    const input = makeInput({
      reviews: [
        {
          id: "r1",
          state: "COMMENTED",
          body: reviewBody,
          submittedAt: "2025-01-01T00:00:00Z",
          author: { __typename: "Bot", login: "coderabbitai[bot]" },
        },
      ],
    });

    const yamlStr = buildYamlOutput(input);
    const doc = yaml.load(yamlStr) as YamlDocument;

    const summaryComments = doc.comments.filter(
      (c) => c.type === "review_summary" && c.reviewer === "coderabbitai",
    );

    assert.ok(summaryComments.length > 0, "should have exploded summary items");

    for (const comment of summaryComments) {
      assert.ok(
        comment.ai_agent_prompt !== null,
        `ai_agent_prompt should not be null for exploded item ${comment.id}`,
      );
    }
  });

  it("includes human-authored inline threads", () => {
    const input = makeInput({
      threads: [
        {
          id: "T1",
          path: "src/index.ts",
          line: 10,
          startLine: null,
          isResolved: false,
          isOutdated: false,
          comments: {
            nodes: [
              {
                id: "C1",
                body: "This looks wrong",
                createdAt: "2026-03-20T00:00:00Z",
                url: "https://github.com/test/pr/1#comment-1",
                author: { __typename: "User", login: "alice" },
              },
            ],
          },
        },
      ],
    });

    const yamlStr = buildYamlOutput(input);
    const doc = yaml.load(yamlStr) as YamlDocument;
    const inlineComments = doc.comments.filter((c) => c.type === "inline");
    assert.equal(inlineComments.length, 1);
    assert.equal(inlineComments[0].reviewer, "alice");
    assert.equal(inlineComments[0].file, "src/index.ts");
  });

  it("includes human reviewers with type 'human' in reviewer list", () => {
    const input = makeInput({
      threads: [
        {
          id: "T1",
          path: "src/index.ts",
          line: 10,
          startLine: null,
          isResolved: false,
          isOutdated: false,
          comments: {
            nodes: [
              {
                id: "C1",
                body: "Looks off",
                createdAt: "2026-03-20T00:00:00Z",
                url: "https://github.com/test/pr/1#comment-1",
                author: { __typename: "User", login: "alice" },
              },
            ],
          },
        },
      ],
    });

    const yamlStr = buildYamlOutput(input);
    const doc = yaml.load(yamlStr) as YamlDocument;
    const alice = doc.reviewers.find((r) => r.id === "alice");
    assert.ok(alice);
    assert.equal(alice.type, "human");
  });

  it("sets is_outdated from thread data", () => {
    const input = makeInput({
      threads: [
        {
          id: "T1",
          path: "src/index.ts",
          line: 10,
          startLine: null,
          isResolved: false,
          isOutdated: true,
          comments: {
            nodes: [
              {
                id: "C1",
                body: "Stale comment",
                createdAt: "2026-03-20T00:00:00Z",
                url: "https://github.com/test/pr/1#comment-1",
                author: { __typename: "Bot", login: "coderabbitai[bot]" },
              },
            ],
          },
        },
      ],
    });

    const yamlStr = buildYamlOutput(input);
    const doc = yaml.load(yamlStr) as YamlDocument;
    assert.equal(doc.comments[0].is_outdated, true);
  });

  it("sets is_outdated to false for review summaries", () => {
    const input = makeInput({
      reviews: [
        {
          id: "r1",
          state: "COMMENTED",
          body: "Overall looks good",
          submittedAt: "2025-01-01T00:00:00Z",
          author: { __typename: "User", login: "bob" },
        },
      ],
    });

    const yamlStr = buildYamlOutput(input);
    const doc = yaml.load(yamlStr) as YamlDocument;
    assert.equal(doc.comments[0].is_outdated, false);
  });

  it("marks reviewers with reviews/threads as status: reviewed", () => {
    const input = makeInput({
      reviews: [
        {
          id: "r1",
          state: "COMMENTED",
          body: "LGTM",
          submittedAt: "2025-01-01T00:00:00Z",
          author: { __typename: "Bot", login: "coderabbitai[bot]" },
        },
      ],
    });

    const yamlStr = buildYamlOutput(input);
    const doc = yaml.load(yamlStr) as YamlDocument;
    const cr = doc.reviewers.find((r) => r.id === "coderabbitai");
    assert.ok(cr);
    assert.equal(cr.status, "reviewed");
  });

  it("includes pending bot reviewers (Copilot) even without any activity", () => {
    const input = makeInput({
      pendingReviewers: [{ login: "Copilot", type: "bot" }],
    });

    const yamlStr = buildYamlOutput(input);
    const doc = yaml.load(yamlStr) as YamlDocument;
    const copilot = doc.reviewers.find((r) => r.id === "Copilot");
    assert.ok(copilot, "Copilot should appear in the reviewers list when pending");
    assert.equal(copilot.type, "bot");
    assert.equal(copilot.status, "pending");
  });

  it("includes pending human reviewers", () => {
    const input = makeInput({
      pendingReviewers: [{ login: "alice", type: "human" }],
    });

    const yamlStr = buildYamlOutput(input);
    const doc = yaml.load(yamlStr) as YamlDocument;
    const alice = doc.reviewers.find((r) => r.id === "alice");
    assert.ok(alice);
    assert.equal(alice.type, "human");
    assert.equal(alice.status, "pending");
  });

  it("filters non-review bots (vercel, linear) out of the reviewers list", () => {
    const input = makeInput({
      comments: [
        {
          id: "c-vercel",
          body: "[vc]: deployment status",
          createdAt: "2026-04-01T00:00:00Z",
          url: "https://github.com/test/pr/1#issuecomment-vercel",
          author: { __typename: "Bot", login: "vercel[bot]" },
        },
        {
          id: "c-linear",
          body: "<!-- linear-linkback -->",
          createdAt: "2026-04-01T00:00:00Z",
          url: "https://github.com/test/pr/1#issuecomment-linear",
          author: { __typename: "Bot", login: "linear[bot]" },
        },
      ],
    });

    const yamlStr = buildYamlOutput(input);
    const doc = yaml.load(yamlStr) as YamlDocument;
    assert.equal(
      doc.reviewers.find((r) => r.id === "vercel"),
      undefined,
      "vercel[bot] should not appear as a reviewer",
    );
    assert.equal(
      doc.reviewers.find((r) => r.id === "linear"),
      undefined,
      "linear[bot] should not appear as a reviewer",
    );
  });

  it("filters non-review bots' general comments out of the comments list", () => {
    const input = makeInput({
      comments: [
        {
          id: "c-vercel",
          body: "[vc]: deployment status",
          createdAt: "2026-04-01T00:00:00Z",
          url: "https://github.com/test/pr/1#issuecomment-vercel",
          author: { __typename: "Bot", login: "vercel[bot]" },
        },
      ],
    });

    const yamlStr = buildYamlOutput(input);
    const doc = yaml.load(yamlStr) as YamlDocument;
    const generalFromVercel = doc.comments.filter(
      (c) => c.type === "general" && c.reviewer === "vercel",
    );
    assert.equal(generalFromVercel.length, 0);
  });

  it("keeps known AI review bot general comments and lists them as reviewers", () => {
    const input = makeInput({
      comments: [
        {
          id: "c-cr-summary",
          body: "<!-- coderabbit summary -->\n".repeat(20),
          createdAt: "2026-04-01T00:00:00Z",
          url: "https://github.com/test/pr/1#issuecomment-cr",
          author: { __typename: "Bot", login: "coderabbitai[bot]" },
        },
      ],
    });

    const yamlStr = buildYamlOutput(input);
    const doc = yaml.load(yamlStr) as YamlDocument;
    assert.ok(doc.reviewers.find((r) => r.id === "coderabbitai"));
    const generalFromCr = doc.comments.filter(
      (c) => c.type === "general" && c.reviewer === "coderabbitai",
    );
    assert.equal(generalFromCr.length, 1);
  });

  it("keeps human-authored general PR comments (not noise)", () => {
    const input = makeInput({
      comments: [
        {
          id: "c-bob",
          body: "Have you considered approach X?",
          createdAt: "2026-04-01T00:00:00Z",
          url: "https://github.com/test/pr/1#issuecomment-bob",
          author: { __typename: "User", login: "bob" },
        },
      ],
    });

    const yamlStr = buildYamlOutput(input);
    const doc = yaml.load(yamlStr) as YamlDocument;
    const bob = doc.reviewers.find((r) => r.id === "bob");
    assert.ok(bob);
    assert.equal(bob.type, "human");
    const generalFromBob = doc.comments.filter(
      (c) => c.type === "general" && c.reviewer === "bob",
    );
    assert.equal(generalFromBob.length, 1);
  });

  it("does not duplicate a pending reviewer who has also reviewed", () => {
    const input = makeInput({
      reviews: [
        {
          id: "r1",
          state: "COMMENTED",
          body: "needs changes",
          submittedAt: "2025-01-01T00:00:00Z",
          author: { __typename: "Bot", login: "coderabbitai[bot]" },
        },
      ],
      pendingReviewers: [{ login: "coderabbitai", type: "bot" }],
    });

    const yamlStr = buildYamlOutput(input);
    const doc = yaml.load(yamlStr) as YamlDocument;
    const matches = doc.reviewers.filter((r) => r.id === "coderabbitai");
    assert.equal(matches.length, 1);
    // GitHub still owes a review (e.g., re-review requested after a past review),
    // so the reviewer is surfaced as pending even though they have past activity.
    assert.equal(matches[0].status, "pending");
  });
});
