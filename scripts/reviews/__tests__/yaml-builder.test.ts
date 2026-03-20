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
});
