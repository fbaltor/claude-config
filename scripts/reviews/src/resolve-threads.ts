/**
 * Library functions for resolving and replying to PR review threads.
 *
 * Uses GitHub GraphQL API for thread resolution and REST API for replies.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { graphql } from "@octokit/graphql";
import { Octokit } from "@octokit/rest";

// ---------------------------------------------------------------------------
// GraphQL Queries (loaded from dedicated .graphql files)
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));

function readQuery(name: string): string {
  return readFileSync(join(__dirname, "queries", name), "utf-8");
}

const UNRESOLVED_THREADS_QUERY = readQuery("unresolved-threads.graphql");
const RESOLVE_THREAD_MUTATION = readQuery("resolve-thread.graphql");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UnresolvedThread {
  threadId: string;
  commentId: number;
  reviewer: string;
  file: string | null;
  line: number | null;
  body: string;
}

export interface ResolveResult {
  threadId: string;
  replied: boolean;
  resolved: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Fetch unresolved threads
// ---------------------------------------------------------------------------

interface ThreadsPage {
  repository: {
    pullRequest: {
      reviewThreads: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: Array<{
          id: string;
          isResolved: boolean;
          isOutdated: boolean;
          comments: {
            nodes: Array<{
              databaseId: number;
              author: { login: string } | null;
              path: string | null;
              line: number | null;
              body: string;
            }>;
          };
        }>;
      };
    };
  };
}

export async function fetchUnresolvedThreads(
  gql: typeof graphql,
  owner: string,
  repo: string,
  pr: number,
): Promise<UnresolvedThread[]> {
  const threads: UnresolvedThread[] = [];
  let cursor: string | null = null;

  do {
    const data = (await gql(UNRESOLVED_THREADS_QUERY, {
      owner,
      repo,
      number: pr,
      cursor,
    })) as ThreadsPage;

    const page = data.repository.pullRequest.reviewThreads;
    for (const node of page.nodes) {
      if (node.isResolved) continue;
      const comment = node.comments.nodes[0];
      if (!comment) continue;

      threads.push({
        threadId: node.id,
        commentId: comment.databaseId,
        reviewer: comment.author?.login?.replace(/\[bot\]$/, "") ?? "unknown",
        file: comment.path,
        line: comment.line,
        body: comment.body,
      });
    }

    cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (cursor);

  return threads;
}

// ---------------------------------------------------------------------------
// Reply to a comment
// ---------------------------------------------------------------------------

export async function replyToComment(
  octokit: Octokit,
  owner: string,
  repo: string,
  pr: number,
  commentId: number,
  body: string,
): Promise<boolean> {
  try {
    await octokit.pulls.createReplyForReviewComment({
      owner,
      repo,
      pull_number: pr,
      comment_id: commentId,
      body,
    });
    return true;
  } catch {
    // Some comment types (e.g., Copilot review comments) use a different API
    // path and return 404. The reply is non-critical — resolution still works.
    return false;
  }
}

// ---------------------------------------------------------------------------
// Resolve a thread
// ---------------------------------------------------------------------------

interface ResolveMutationResult {
  resolveReviewThread: {
    thread: { isResolved: boolean };
  };
}

export async function resolveThread(
  gql: typeof graphql,
  threadId: string,
): Promise<boolean> {
  const data = await gql<ResolveMutationResult>(RESOLVE_THREAD_MUTATION, {
    threadId,
  });
  return data.resolveReviewThread.thread.isResolved;
}

// ---------------------------------------------------------------------------
// Combined: reply + resolve
// ---------------------------------------------------------------------------

export async function replyAndResolve(
  gql: typeof graphql,
  octokit: Octokit,
  owner: string,
  repo: string,
  pr: number,
  thread: UnresolvedThread,
  replyBody: string,
): Promise<ResolveResult> {
  const replied = await replyToComment(
    octokit, owner, repo, pr, thread.commentId, replyBody,
  );

  try {
    const resolved = await resolveThread(gql, thread.threadId);
    return { threadId: thread.threadId, replied, resolved };
  } catch (err) {
    return {
      threadId: thread.threadId,
      replied,
      resolved: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
