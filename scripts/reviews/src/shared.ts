export interface Author {
  __typename: string;
  login: string;
}

export interface ReviewNode {
  id: string;
  state: string;
  body: string;
  submittedAt: string;
  author: Author | null;
}

export interface ReviewThreadCommentNode {
  id: string;
  body: string;
  createdAt: string;
  url: string;
  author: Author | null;
}

export interface ReviewThreadNode {
  id: string;
  path: string;
  line: number | null;
  startLine: number | null;
  isResolved: boolean;
  isOutdated: boolean;
  comments: { nodes: ReviewThreadCommentNode[] };
}

export interface CommentNode {
  id: string;
  body: string;
  createdAt: string;
  url: string;
  author: Author | null;
}

export interface PrMeta {
  title: string;
  url: string;
  author: string;
  baseRefName: string;
  headRefName: string;
  createdAt: string;
  changedFiles: number;
}

export interface ReviewerData {
  reviews: ReviewNode[];
  threads: ReviewThreadNode[];
  comments: CommentNode[];
}

export function isBot(author: Author | null): boolean {
  return author?.__typename === "Bot";
}

export function getAuthorName(author: Author | null): string {
  return author?.login?.replace("[bot]", "") ?? "unknown";
}

/** Returns "bot" or "human" based on GitHub author typename. */
export function getAuthorType(author: Author | null): "bot" | "human" {
  return isBot(author) ? "bot" : "human";
}

/**
 * Known AI code review bots (allowlist).
 *
 * @bot-specific: Names are GitHub App slugs extracted from `author.login`
 * after stripping the `[bot]` suffix. They may change when bots update
 * their GitHub App registration or on GitHub Enterprise instances.
 * Verify: check `author.login` in a real PR review from each bot.
 */
export const AI_REVIEWERS: string[] = [
  "coderabbitai",                    // @bot-specific(coderabbit)
  "copilot-pull-request-reviewer",   // @bot-specific(copilot): unverified — confirm on first real review
  "kody-ai",                         // @bot-specific(kody)
];

export function isReviewBot(author: Author | null): boolean {
  return isBot(author) && AI_REVIEWERS.includes(getAuthorName(author));
}

/**
 * Check run names to ignore during CI failure detection.
 *
 * These are jobs from AI review tools that run as GitHub Actions (so their
 * app_slug is "github-actions") rather than as dedicated GitHub Apps. They
 * can't be filtered by AI_REVIEWERS (which matches app slugs), so we match
 * on the check run name instead.
 *
 * @bot-specific(copilot): The "Agent" job comes from Copilot's dynamic
 * workflow (dynamic/copilot-pull-request-reviewer). It runs a code review
 * agent step that can fail without indicating a real CI problem.
 */
export const IGNORED_CI_CHECK_NAMES: string[] = [
  "Agent", // @bot-specific(copilot): Copilot's dynamic review agent job
];

/** Attribute a thread to its first commenter. */
export function getThreadAuthor(thread: ReviewThreadNode): string {
  const first = thread.comments.nodes[0];
  return getAuthorName(first?.author ?? null);
}
