/**
 * Fetches review comments from a GitHub PR and saves them in multiple formats.
 *
 * By default fetches ALL reviewers (human + bot). Use --bot or --human to filter.
 *
 * Usage:
 *   npx tsx reviews/fetch-reviews.ts --pr <number>
 *
 * If --pr is omitted, the script tries to detect the PR from the current branch.
 * Requires: `gh` CLI authenticated with repo access, or GITHUB_TOKEN env var.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { graphql } from "@octokit/graphql";
import { Octokit } from "@octokit/rest";
import { getGitHubToken, parseCommonArgs } from "./cli-utils.js";
import { waitForCompletion } from "./check-reviews.js";
import { buildYamlOutput } from "./yaml-builder/index.js";
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

interface JsonSidecar {
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

async function fetchAllReviews(
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

async function fetchAllReviewThreads(
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

async function fetchAllComments(
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

// ---------------------------------------------------------------------------
// CLI arg parsing
// ---------------------------------------------------------------------------

interface CliArgs {
  pr: number;
  owner: string;
  repo: string;
  wait: boolean;
  rerun: boolean;
  filter: ReviewFilter;
}

function printHelp(): never {
  console.log(`Usage: npx tsx reviews/fetch-reviews.ts [options]

Fetches review comments from a GitHub PR and saves them
as timestamped files in .pr-reviews/ (current working directory).

By default fetches ALL reviewers (human + bot).

Options:
  --pr <number>      PR number (auto-detects from current branch if omitted)
  --repo owner/repo  Target repository (default: Jumpstart-Immigration/jumpstart)
  --bot              Only include bot reviewers
  --human            Only include human reviewers
  --wait             Wait for AI review checks to complete before fetching
  --rerun            Re-trigger failed review checks (use with --wait)
  --help             Show this help message

Requires: gh CLI authenticated with repo access, or GITHUB_TOKEN env var.

Examples:
  npx tsx reviews/fetch-reviews.ts --pr 39
  npx tsx reviews/fetch-reviews.ts --bot --pr 39
  npx tsx reviews/fetch-reviews.ts --wait --pr 39`);
  process.exit(0);
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  if (args.includes("--help")) printHelp();

  const common = parseCommonArgs(args);

  let filter: ReviewFilter = "all";
  if (args.includes("--bot")) filter = "bot";
  else if (args.includes("--human")) filter = "human";

  return {
    ...common,
    wait: args.includes("--wait"),
    rerun: args.includes("--rerun"),
    filter,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { pr, owner, repo, wait, rerun, filter } = parseArgs();

  const token = getGitHubToken();

  // If --wait, delegate to status checker first
  if (wait) {
    console.log(`Checking AI review status for PR #${pr}...`);
    const octokit = new Octokit({ auth: token });
    const result = await waitForCompletion(octokit, owner, repo, pr, { rerun });
    if (!result.allCompleted || result.anyFailed) {
      console.error("AI reviews did not complete successfully. Aborting fetch.");
      process.exit(1);
    }
    console.log("Fetching comments...\n");
  }

  const filterLabel = filter === "all" ? "" : ` (${filter} only)`;
  console.log(
    `Fetching review comments for ${owner}/${repo} PR #${pr}${filterLabel}...`,
  );

  const now = new Date();
  const isoString = now.toISOString();
  const localISO = new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString();
  const timestamp = localISO.replace(/[:T]/g, "-").slice(0, 19);

  const gql = graphql.defaults({
    headers: { authorization: `token ${token}` },
  });

  const [{ prMeta, reviews: allReviews }, allThreads, allComments] =
    await Promise.all([
      fetchAllReviews(gql, owner, repo, pr),
      fetchAllReviewThreads(gql, owner, repo, pr),
      fetchAllComments(gql, owner, repo, pr),
    ]);

  checkNestedTruncation(allThreads);

  // Apply reviewer filter (default: all)
  const reviews = allReviews.filter((r) => matchesFilter(r.author, filter));

  const filteredThreads = allThreads.filter((thread) => {
    const first = thread.comments.nodes[0];
    return first != null && matchesFilter(first.author, filter);
  });

  const prComments = allComments.filter((c) => matchesFilter(c.author, filter));

  console.log(
    `Found: ${reviews.length} reviews, ${filteredThreads.length} inline threads, ${prComments.length} PR comments`,
  );

  // Build markdown
  const lines: string[] = [];

  lines.push(`# PR Reviews — #${pr}`);
  lines.push("");
  lines.push(`> **PR**: [#${pr} — ${prMeta.title}](${prMeta.url})`);
  lines.push(`> **Generated**: ${isoString}`);
  lines.push("");
  lines.push("---");
  lines.push("");

  // Section 1: Review summaries (grouped by bot, empty bodies collapsed)
  if (reviews.length > 0) {
    lines.push("## Review Summaries");
    lines.push("");

    const reviewsByReviewer = groupByReviewer(reviews);

    for (const [reviewerName, reviewerReviews] of reviewsByReviewer) {
      const withBody = reviewerReviews.filter((r) => r.body);
      const emptyCount = reviewerReviews.length - withBody.length;

      for (const review of withBody) {
        lines.push(
          `### Review by ${reviewerName} (state: ${review.state})`,
        );
        lines.push("");
        lines.push(review.body);
        lines.push("");
        lines.push("---");
        lines.push("");
      }

      if (emptyCount > 0) {
        lines.push(
          `_${reviewerName} posted ${emptyCount} inline review${emptyCount > 1 ? "s" : ""} (see Inline Comments below)_`,
        );
        lines.push("");
        lines.push("---");
        lines.push("");
      }
    }
  }

  // Section 2: Inline review comments (file-specific)
  if (filteredThreads.length > 0) {
    lines.push("## Inline Comments (File-Specific)");
    lines.push("");

    // Group by file path for better readability
    const byFile = new Map<string, ReviewThreadNode[]>();
    for (const thread of filteredThreads) {
      const existing = byFile.get(thread.path) ?? [];
      existing.push(thread);
      byFile.set(thread.path, existing);
    }

    for (const [filePath, threads] of byFile) {
      lines.push(`### \`${filePath}\``);
      lines.push("");

      for (const thread of threads) {
        const lineInfo = thread.line ? ` (line ${thread.line})` : "";
        const resolvedTag = thread.isResolved ? " [resolved]" : "";
        lines.push(`#### ${lineInfo}${resolvedTag}`);
        lines.push("");

        // Include all comments in the thread (bot and human replies)
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
  }

  // Section 3: General PR comments
  if (prComments.length > 0) {
    lines.push("## General PR Comments");
    lines.push("");

    for (const comment of prComments) {
      lines.push(
        `### ${getAuthorName(comment.author)} (${comment.createdAt})`,
      );
      lines.push("");
      lines.push(comment.body);
      lines.push("");
      lines.push("---");
      lines.push("");
    }
  }

  // Write raw output
  const outDir = join(
    process.cwd(),
    ".pr-reviews",
  );
  mkdirSync(outDir, { recursive: true });

  const outPath = join(outDir, `pr-${pr}-reviews-${timestamp}.md`);
  writeFileSync(outPath, lines.join("\n"), "utf-8");

  console.log(`Saved to ${outPath}`);

  // Write by-bot organized output
  const reviewerMap = collectByReviewer(reviews, filteredThreads, prComments);
  const byReviewerContent = buildByReviewerMarkdown(
    pr,
    prMeta.title,
    prMeta.url,
    isoString,
    reviewerMap,
  );
  const byReviewerPath = join(outDir, `pr-${pr}-reviews-${timestamp}-by-reviewer.md`);
  writeFileSync(byReviewerPath, byReviewerContent, "utf-8");

  console.log(`Saved to ${byReviewerPath}`);

  // Write JSON sidecar
  const sidecar = buildJsonSidecar(
    pr,
    `${owner}/${repo}`,
    prMeta.title,
    prMeta.url,
    isoString,
    reviewerMap,
    filteredThreads,
  );
  const jsonPath = join(outDir, `pr-${pr}-reviews-${timestamp}.json`);
  writeFileSync(jsonPath, JSON.stringify(sidecar, null, 2), "utf-8");

  console.log(`Saved to ${jsonPath}`);

  // Write YAML output
  const yamlContent = buildYamlOutput({
    pr,
    owner,
    repo,
    prMeta,
    reviews,
    threads: filteredThreads,
    comments: prComments,
  });
  const yamlPath = join(outDir, `pr-${pr}-reviews-${timestamp}.yaml`);
  writeFileSync(yamlPath, yamlContent, "utf-8");

  console.log(`Saved to ${yamlPath}`);
}

const isMainModule = process.argv[1]?.endsWith("fetch-reviews.ts");
if (isMainModule) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
