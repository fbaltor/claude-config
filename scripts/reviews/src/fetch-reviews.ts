/**
 * Library functions for fetching and formatting PR review comments.
 *
 * Fetches reviews, inline threads, and general comments from GitHub's GraphQL
 * API, then provides helpers to filter, group, and format them.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { graphql } from "@octokit/graphql";
import {
  isBot,
  getAuthorName,
  getAuthorType,
  getThreadAuthor,
  type Author,
  type ReviewNode,
  type ReviewThreadNode,
  type CommentNode,
  type PrMeta,
  type ReviewerData,
} from "./shared.js";

// ---------------------------------------------------------------------------
// Review filter
// ---------------------------------------------------------------------------

export type ReviewFilter = "all" | "bot" | "human";

export function matchesFilter(author: Author | null, filter: ReviewFilter): boolean {
  if (filter === "all") return true;
  if (filter === "bot") return isBot(author);
  return !isBot(author); // "human"
}

export interface JsonSidecar {
  pr: number;
  repo: string;
  title: string;
  url: string;
  generatedAt: string;
  reviewers: {
    name: string;
    reviewCount: number;
    threadCount: number;
    commentCount: number;
    resolvedThreads: number;
    unresolvedThreads: number;
  }[];
  filesTouched: string[];
  threads: {
    reviewer: string;
    file: string;
    line: number | null;
    isResolved: boolean;
  }[];
  totals: {
    reviews: number;
    threads: number;
    comments: number;
    resolvedThreads: number;
    unresolvedThreads: number;
    filesWithComments: number;
  };
}

// ---------------------------------------------------------------------------
// GraphQL Queries (loaded from dedicated .graphql files)
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));

function readQuery(name: string): string {
  return readFileSync(join(__dirname, "queries", name), "utf-8");
}

const REVIEWS_QUERY = readQuery("reviews.graphql");
const REVIEW_THREADS_QUERY = readQuery("review-threads.graphql");
const COMMENTS_QUERY = readQuery("comments.graphql");

// ---------------------------------------------------------------------------
// Paginated fetchers
// ---------------------------------------------------------------------------

interface ReviewsPage {
  repository: {
    pullRequest: {
      title: string;
      url: string;
      author: { login: string } | null;
      baseRefName: string;
      headRefName: string;
      createdAt: string;
      changedFiles: number;
      reviews: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: ReviewNode[];
      };
    };
  };
}

interface ReviewThreadsPage {
  repository: {
    pullRequest: {
      reviewThreads: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: ReviewThreadNode[];
      };
    };
  };
}

interface CommentsPage {
  repository: {
    pullRequest: {
      comments: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: CommentNode[];
      };
    };
  };
}

export async function fetchAllReviews(
  gql: typeof graphql,
  owner: string,
  repo: string,
  pr: number,
): Promise<{ prMeta: PrMeta; reviews: ReviewNode[] }> {
  const allReviews: ReviewNode[] = [];
  let cursor: string | null = null;
  let prMeta: PrMeta | null = null;

  while (true) {
    const data: ReviewsPage = await gql<ReviewsPage>(
      REVIEWS_QUERY,
      { owner, repo, number: pr, cursor },
    );

    const { pullRequest } = data.repository;
    if (!pullRequest) {
      throw new Error(`PR #${pr} not found in ${owner}/${repo}`);
    }

    if (!prMeta) {
      prMeta = {
        title: pullRequest.title,
        url: pullRequest.url,
        author: pullRequest.author?.login ?? "unknown",
        baseRefName: pullRequest.baseRefName,
        headRefName: pullRequest.headRefName,
        createdAt: pullRequest.createdAt,
        changedFiles: pullRequest.changedFiles,
      };
    }

    allReviews.push(...pullRequest.reviews.nodes);

    if (!pullRequest.reviews.pageInfo.hasNextPage) break;
    cursor = pullRequest.reviews.pageInfo.endCursor;
  }

  return { prMeta: prMeta!, reviews: allReviews };
}

export async function fetchAllReviewThreads(
  gql: typeof graphql,
  owner: string,
  repo: string,
  pr: number,
): Promise<ReviewThreadNode[]> {
  const allThreads: ReviewThreadNode[] = [];
  let cursor: string | null = null;

  while (true) {
    const data: ReviewThreadsPage =
      await gql<ReviewThreadsPage>(REVIEW_THREADS_QUERY, {
        owner,
        repo,
        number: pr,
        cursor,
      });

    if (!data.repository.pullRequest) {
      throw new Error(`PR #${pr} not found in ${owner}/${repo}`);
    }
    const { reviewThreads } = data.repository.pullRequest;
    allThreads.push(...reviewThreads.nodes);

    if (!reviewThreads.pageInfo.hasNextPage) break;
    cursor = reviewThreads.pageInfo.endCursor;
  }

  return allThreads;
}

export async function fetchAllComments(
  gql: typeof graphql,
  owner: string,
  repo: string,
  pr: number,
): Promise<CommentNode[]> {
  const allComments: CommentNode[] = [];
  let cursor: string | null = null;

  while (true) {
    const data: CommentsPage = await gql<CommentsPage>(
      COMMENTS_QUERY,
      { owner, repo, number: pr, cursor },
    );

    if (!data.repository.pullRequest) {
      throw new Error(`PR #${pr} not found in ${owner}/${repo}`);
    }
    const { comments } = data.repository.pullRequest;
    allComments.push(...comments.nodes);

    if (!comments.pageInfo.hasNextPage) break;
    cursor = comments.pageInfo.endCursor;
  }

  return allComments;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function checkNestedTruncation(threads: ReviewThreadNode[]): void {
  const warnings: string[] = [];
  for (const thread of threads) {
    if (thread.comments.nodes.length >= 100) {
      warnings.push(
        `thread replies in ${thread.path}:${thread.line ?? "?"} (100 limit)`,
      );
    }
  }
  if (warnings.length > 0) {
    console.warn(
      `Warning: Data may be truncated -- hit pagination limits for: ${warnings.join(", ")}`,
    );
  }
}

export function groupByReviewer<T extends { author: Author | null }>(
  items: T[],
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const name = getAuthorName(item.author);
    const existing = map.get(name) ?? [];
    existing.push(item);
    map.set(name, existing);
  }
  return map;
}

// ---------------------------------------------------------------------------
// By-bot organized output
// ---------------------------------------------------------------------------

export function collectByReviewer(
  reviews: ReviewNode[],
  threads: ReviewThreadNode[],
  comments: CommentNode[],
): Map<string, ReviewerData> {
  const map = new Map<string, ReviewerData>();

  function ensure(name: string): ReviewerData {
    let data = map.get(name);
    if (!data) {
      data = { reviews: [], threads: [], comments: [] };
      map.set(name, data);
    }
    return data;
  }

  for (const r of reviews) ensure(getAuthorName(r.author)).reviews.push(r);
  for (const t of threads) ensure(getThreadAuthor(t)).threads.push(t);
  for (const c of comments) ensure(getAuthorName(c.author)).comments.push(c);

  return map;
}

export function buildJsonSidecar(
  pr: number,
  repo: string,
  title: string,
  url: string,
  generatedAt: string,
  reviewerMap: Map<string, ReviewerData>,
  filteredThreads: ReviewThreadNode[],
): JsonSidecar {
  const reviewers = [...reviewerMap.entries()].map(([name, data]) => ({
    name,
    reviewCount: data.reviews.length,
    threadCount: data.threads.length,
    commentCount: data.comments.length,
    resolvedThreads: data.threads.filter((t) => t.isResolved).length,
    unresolvedThreads: data.threads.filter((t) => !t.isResolved).length,
  }));

  const allFiles = new Set(filteredThreads.map((t) => t.path));

  const threads = filteredThreads.map((t) => ({
    reviewer: getThreadAuthor(t),
    file: t.path,
    line: t.line,
    isResolved: t.isResolved,
  }));

  const resolvedCount = filteredThreads.filter((t) => t.isResolved).length;

  return {
    pr,
    repo,
    title,
    url,
    generatedAt,
    reviewers,
    filesTouched: [...allFiles].sort(),
    threads,
    totals: {
      reviews: reviewers.reduce((sum, r) => sum + r.reviewCount, 0),
      threads: filteredThreads.length,
      comments: reviewers.reduce((sum, r) => sum + r.commentCount, 0),
      resolvedThreads: resolvedCount,
      unresolvedThreads: filteredThreads.length - resolvedCount,
      filesWithComments: allFiles.size,
    },
  };
}

export function buildByReviewerMarkdown(
  prNumber: number,
  title: string,
  url: string,
  generatedAt: string,
  reviewerMap: Map<string, ReviewerData>,
): string {
  const lines: string[] = [];

  lines.push(`# PR Reviews — #${prNumber} (by reviewer)`);
  lines.push("");
  lines.push(`> **PR**: [#${prNumber} — ${title}](${url})`);
  lines.push(`> **Generated**: ${generatedAt}`);
  lines.push("");
  lines.push("---");
  lines.push("");

  for (const [reviewerName, data] of reviewerMap) {
    lines.push(`## ${reviewerName}`);
    lines.push("");

    // Review summaries
    lines.push("### Review Summary");
    lines.push("");
    const withBody = data.reviews.filter((r) => r.body);
    const emptyCount = data.reviews.length - withBody.length;

    if (withBody.length > 0) {
      for (const review of withBody) {
        lines.push(review.body);
        lines.push("");
      }
    }
    if (emptyCount > 0) {
      lines.push(
        `_${reviewerName} posted ${emptyCount} inline review${emptyCount > 1 ? "s" : ""} (see Inline Comments below)_`,
      );
      lines.push("");
    }
    if (withBody.length === 0 && emptyCount === 0) {
      lines.push("_(none)_");
      lines.push("");
    }

    // Inline comments grouped by file
    lines.push("### Inline Comments");
    lines.push("");

    if (data.threads.length > 0) {
      const byFile = new Map<string, ReviewThreadNode[]>();
      for (const thread of data.threads) {
        const existing = byFile.get(thread.path) ?? [];
        existing.push(thread);
        byFile.set(thread.path, existing);
      }

      for (const [filePath, threads] of byFile) {
        lines.push(`#### \`${filePath}\``);
        lines.push("");

        for (const thread of threads) {
          const lineInfo = thread.line ? ` (line ${thread.line})` : "";
          const resolvedTag = thread.isResolved ? " [resolved]" : "";
          lines.push(`#####${lineInfo}${resolvedTag}`);
          lines.push("");

          for (const comment of thread.comments.nodes) {
            const authorName = getAuthorName(comment.author);
            const authorType = getAuthorType(comment.author);
            lines.push(`**${authorName}** _(${authorType})_:`);
            lines.push("");
            lines.push(comment.body);
            lines.push("");
          }
          lines.push("---");
          lines.push("");
        }
      }
    } else {
      lines.push("_(none)_");
      lines.push("");
    }

    // General PR comments
    lines.push("### General PR Comments");
    lines.push("");

    if (data.comments.length > 0) {
      for (const comment of data.comments) {
        lines.push(`**${comment.createdAt}**`);
        lines.push("");
        lines.push(comment.body);
        lines.push("");
        lines.push("---");
        lines.push("");
      }
    } else {
      lines.push("_(none)_");
      lines.push("");
    }

    lines.push("---");
    lines.push("");
  }

  return lines.join("\n");
}
