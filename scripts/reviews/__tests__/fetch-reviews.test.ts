import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";

import {
  groupByReviewer,
  collectByReviewer,
  buildJsonSidecar,
  buildByReviewerMarkdown,
  checkNestedTruncation,
  matchesFilter,
} from "../src/fetch-reviews.js";
import {
  isBot,
  getAuthorName,
  getAuthorType,
  isReviewBot,
  getThreadAuthor,
  type Author,
  type ReviewNode,
  type ReviewThreadNode,
  type CommentNode,
  type ReviewerData,
} from "../src/shared.js";

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function makeAuthor(overrides: Partial<Author> = {}): Author {
  return { __typename: "Bot", login: "coderabbit[bot]", ...overrides };
}

function makeReview(overrides: Partial<ReviewNode> = {}): ReviewNode {
  return {
    id: "r1",
    state: "COMMENTED",
    body: "Looks good",
    submittedAt: "2025-01-01T00:00:00Z",
    author: makeAuthor(),
    ...overrides,
  };
}

function makeThread(
  overrides: Partial<ReviewThreadNode> = {},
): ReviewThreadNode {
  return {
    id: "t1",
    path: "src/index.ts",
    line: 10,
    startLine: null,
    isResolved: false,
    isOutdated: false,
    comments: {
      nodes: [
        {
          id: "tc1",
          body: "Consider refactoring",
          createdAt: "2025-01-01T00:00:00Z",
          url: "https://github.com/test/pr/1#comment-1",
          author: makeAuthor(),
        },
      ],
    },
    ...overrides,
  };
}

function makeComment(overrides: Partial<CommentNode> = {}): CommentNode {
  return {
    id: "c1",
    body: "General comment",
    createdAt: "2025-01-01T00:00:00Z",
    url: "https://github.com/test/pr/1#comment-1",
    author: makeAuthor(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("isBot", () => {
  it("returns true for Bot authors", () => {
    assert.equal(isBot(makeAuthor()), true);
  });

  it("returns false for User authors", () => {
    assert.equal(
      isBot(makeAuthor({ __typename: "User", login: "alice" })),
      false,
    );
  });

  it("returns false for null", () => {
    assert.equal(isBot(null), false);
  });
});

describe("getAuthorName", () => {
  it("strips [bot] suffix", () => {
    assert.equal(getAuthorName(makeAuthor({ login: "coderabbit[bot]" })), "coderabbit");
  });

  it('returns "unknown" for null', () => {
    assert.equal(getAuthorName(null), "unknown");
  });

  it("returns human login as-is", () => {
    assert.equal(
      getAuthorName(makeAuthor({ __typename: "User", login: "alice" })),
      "alice",
    );
  });
});

describe("getAuthorType", () => {
  it("returns 'bot' for Bot typename", () => {
    assert.equal(getAuthorType(makeAuthor()), "bot");
  });

  it("returns 'human' for User typename", () => {
    assert.equal(getAuthorType(makeAuthor({ __typename: "User", login: "alice" })), "human");
  });

  it("returns 'human' for null author", () => {
    assert.equal(getAuthorType(null), "human");
  });
});

describe("isReviewBot", () => {
  it("returns true for known AI review bots", () => {
    assert.equal(isReviewBot(makeAuthor({ login: "coderabbitai[bot]" })), true);
    assert.equal(isReviewBot(makeAuthor({ login: "kody-ai[bot]" })), true);
  });

  it("returns true for copilot-pull-request-reviewer", () => {
    assert.equal(
      isReviewBot(makeAuthor({ login: "copilot-pull-request-reviewer[bot]" })),
      true,
    );
  });

  it("returns false for non-review bots", () => {
    assert.equal(isReviewBot(makeAuthor({ login: "vercel[bot]" })), false);
    assert.equal(isReviewBot(makeAuthor({ login: "dependabot[bot]" })), false);
  });

  it("returns false for human users", () => {
    assert.equal(isReviewBot(makeAuthor({ __typename: "User", login: "alice" })), false);
  });
});

describe("matchesFilter", () => {
  const bot: Author = { __typename: "Bot", login: "coderabbitai[bot]" };
  const human: Author = { __typename: "User", login: "alice" };

  it("'all' matches everything", () => {
    assert.ok(matchesFilter(bot, "all"));
    assert.ok(matchesFilter(human, "all"));
    assert.ok(matchesFilter(null, "all"));
  });

  it("'bot' matches only bots", () => {
    assert.ok(matchesFilter(bot, "bot"));
    assert.equal(matchesFilter(human, "bot"), false);
  });

  it("'human' matches only humans", () => {
    assert.equal(matchesFilter(bot, "human"), false);
    assert.ok(matchesFilter(human, "human"));
  });

  it("'human' returns true for null author", () => {
    assert.ok(matchesFilter(null, "human"));
  });
});

describe("groupByReviewer", () => {
  it("groups items by author name", () => {
    const items = [
      { author: makeAuthor({ login: "coderabbit[bot]" }), id: "1" },
      { author: makeAuthor({ login: "copilot[bot]" }), id: "2" },
      { author: makeAuthor({ login: "coderabbit[bot]" }), id: "3" },
    ];

    const grouped = groupByReviewer(items);

    assert.equal(grouped.get("coderabbit")?.length, 2);
    assert.equal(grouped.get("copilot")?.length, 1);
  });

  it("handles mixed bot and human authors", () => {
    const items = [
      { author: makeAuthor({ login: "coderabbit[bot]" }), id: "1" },
      { author: makeAuthor({ __typename: "User", login: "alice" }), id: "2" },
    ];

    const grouped = groupByReviewer(items);

    assert.equal(grouped.get("coderabbit")?.length, 1);
    assert.equal(grouped.get("alice")?.length, 1);
  });
});

describe("getThreadAuthor", () => {
  it("returns the name of the first commenter (bot)", () => {
    const thread = makeThread({
      comments: {
        nodes: [
          {
            id: "tc1",
            body: "bot comment",
            createdAt: "2025-01-01T00:00:00Z",
            url: "https://github.com/test",
            author: makeAuthor({ login: "coderabbit[bot]" }),
          },
          {
            id: "tc2",
            body: "human reply",
            createdAt: "2025-01-01T00:00:00Z",
            url: "https://github.com/test",
            author: makeAuthor({ __typename: "User", login: "alice" }),
          },
        ],
      },
    });

    assert.equal(getThreadAuthor(thread), "coderabbit");
  });

  it("returns the name of the first commenter (human)", () => {
    const thread = makeThread({
      comments: {
        nodes: [
          {
            id: "tc1",
            body: "human comment",
            createdAt: "2025-01-01T00:00:00Z",
            url: "https://github.com/test",
            author: makeAuthor({ __typename: "User", login: "alice" }),
          },
          {
            id: "tc2",
            body: "bot reply",
            createdAt: "2025-01-01T00:00:00Z",
            url: "https://github.com/test",
            author: makeAuthor({ login: "coderabbit[bot]" }),
          },
        ],
      },
    });

    assert.equal(getThreadAuthor(thread), "alice");
  });

  it('returns "unknown" for empty thread', () => {
    const thread = makeThread({ comments: { nodes: [] } });
    assert.equal(getThreadAuthor(thread), "unknown");
  });
});

describe("collectByReviewer", () => {
  it("organizes reviews, threads, and comments into per-reviewer data", () => {
    const reviews = [
      makeReview({ id: "r1", author: makeAuthor({ login: "coderabbit[bot]" }) }),
      makeReview({ id: "r2", author: makeAuthor({ login: "copilot[bot]" }) }),
    ];
    const threads = [
      makeThread({
        id: "t1",
        comments: {
          nodes: [
            {
              id: "tc1",
              body: "bot comment",
              createdAt: "2025-01-01T00:00:00Z",
              url: "https://github.com/test",
              author: makeAuthor({ login: "coderabbit[bot]" }),
            },
          ],
        },
      }),
    ];
    const comments = [
      makeComment({ id: "c1", author: makeAuthor({ login: "copilot[bot]" }) }),
    ];

    const map = collectByReviewer(reviews, threads, comments);

    const coderabbit = map.get("coderabbit")!;
    assert.equal(coderabbit.reviews.length, 1);
    assert.equal(coderabbit.threads.length, 1);
    assert.equal(coderabbit.comments.length, 0);

    const copilot = map.get("copilot")!;
    assert.equal(copilot.reviews.length, 1);
    assert.equal(copilot.threads.length, 0);
    assert.equal(copilot.comments.length, 1);
  });
});

describe("buildJsonSidecar", () => {
  it("returns correct structure with totals, filesTouched, thread summaries", () => {
    const reviewerMap = new Map<string, ReviewerData>();
    reviewerMap.set("coderabbit", {
      reviews: [makeReview()],
      threads: [makeThread({ isResolved: true }), makeThread({ id: "t2", path: "src/utils.ts", isResolved: false })],
      comments: [makeComment()],
    });

    const filteredThreads = [
      makeThread({ isResolved: true }),
      makeThread({ id: "t2", path: "src/utils.ts", isResolved: false }),
    ];

    const result = buildJsonSidecar(
      42,
      "org/repo",
      "Test PR",
      "https://github.com/org/repo/pull/42",
      "2025-01-01T00:00:00Z",
      reviewerMap,
      filteredThreads,
    );

    assert.equal(result.pr, 42);
    assert.equal(result.repo, "org/repo");
    assert.equal(result.title, "Test PR");
    assert.equal(result.reviewers.length, 1);
    assert.equal(result.reviewers[0].name, "coderabbit");
    assert.equal(result.reviewers[0].reviewCount, 1);
    assert.equal(result.reviewers[0].threadCount, 2);
    assert.equal(result.reviewers[0].resolvedThreads, 1);
    assert.equal(result.reviewers[0].unresolvedThreads, 1);
    assert.deepEqual(result.filesTouched, ["src/index.ts", "src/utils.ts"]);
    assert.equal(result.threads.length, 2);
    assert.equal(result.totals.reviews, 1);
    assert.equal(result.totals.threads, 2);
    assert.equal(result.totals.resolvedThreads, 1);
    assert.equal(result.totals.unresolvedThreads, 1);
    assert.equal(result.totals.filesWithComments, 2);
  });
});

describe("buildByReviewerMarkdown", () => {
  it("contains expected headers, PR link, and reviewer sections", () => {
    const reviewerMap = new Map<string, ReviewerData>();
    reviewerMap.set("coderabbit", {
      reviews: [makeReview({ body: "LGTM" })],
      threads: [makeThread()],
      comments: [],
    });

    const md = buildByReviewerMarkdown(
      42,
      "Test PR",
      "https://github.com/org/repo/pull/42",
      "2025-01-01T00:00:00Z",
      reviewerMap,
    );

    assert.ok(md.includes("# PR Reviews — #42 (by reviewer)"));
    assert.ok(md.includes("[#42 — Test PR](https://github.com/org/repo/pull/42)"));
    assert.ok(md.includes("## coderabbit"));
    assert.ok(md.includes("### Review Summary"));
    assert.ok(md.includes("LGTM"));
    assert.ok(md.includes("### Inline Comments"));
    assert.ok(md.includes("`src/index.ts`"));
    assert.ok(md.includes("### General PR Comments"));
  });
});

describe("checkNestedTruncation", () => {
  let warnMock: ReturnType<typeof mock.fn>;
  let originalWarn: typeof console.warn;

  beforeEach(() => {
    originalWarn = console.warn;
    warnMock = mock.fn();
    console.warn = warnMock;
  });

  afterEach(() => {
    console.warn = originalWarn;
  });

  it("warns when a thread has >= 100 comments", () => {
    const nodes = Array.from({ length: 100 }, (_, i) => ({
      id: `tc${i}`,
      body: "comment",
      createdAt: "2025-01-01T00:00:00Z",
      url: "https://github.com/test",
      author: makeAuthor(),
    }));

    checkNestedTruncation([makeThread({ comments: { nodes } })]);

    assert.equal(warnMock.mock.calls.length, 1);
    const msg = warnMock.mock.calls[0].arguments[0] as string;
    assert.ok(msg.includes("truncated"));
  });

  it("stays silent when all threads have < 100 comments", () => {
    checkNestedTruncation([makeThread()]);

    assert.equal(warnMock.mock.calls.length, 0);
  });
});
