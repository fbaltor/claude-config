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
  "copilot-pull-request-reviewer",   // @bot-specific(copilot): verified via dynamic/copilot-pull-request-reviewer workflow Agent job
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

/**
 * Job names published by Copilot's dynamic review workflow.
 * Paired with COPILOT_WORKFLOW_PATH below — both must match before we treat
 * a check run as a Copilot review progress signal.
 *
 * @bot-specific(copilot): Verify against a real PR — if Copilot renames the
 * job, update this list. See also IGNORED_CI_CHECK_NAMES which must stay
 * in sync so the same job isn't double-reported.
 */
export const COPILOT_REVIEW_JOB_NAMES: string[] = ["Agent"];

/**
 * The dynamic workflow path Copilot uses for PR review runs.
 * Verified against live PRs — update if GitHub renames the workflow.
 */
export const COPILOT_WORKFLOW_PATH = "dynamic/copilot-pull-request-reviewer";

/**
 * Maps the GitHub user login shown in `pulls.listRequestedReviewers.users[].login`
 * to the bot's canonical display name and app slug. Used to synthesize "pending"
 * check entries when a bot has been requested as a reviewer but hasn't started
 * a check run yet — otherwise --wait returns prematurely thinking no bots are
 * running.
 *
 * @bot-specific(copilot): The login is `Copilot` (capital C), which is
 * different from the app slug `copilot-pull-request-reviewer` used elsewhere.
 * Verify via `GET /repos/{o}/{r}/pulls/{n}/requested_reviewers` on a live PR.
 */
export const AI_REVIEWER_REQUESTED_LOGINS: Record<
  string,
  { displayName: string; appSlug: string }
> = {
  Copilot: {
    displayName: "Copilot",
    appSlug: "copilot-pull-request-reviewer",
  },
};

/** Attribute a thread to its first commenter. */
export function getThreadAuthor(thread: ReviewThreadNode): string {
  const first = thread.comments.nodes[0];
  return getAuthorName(first?.author ?? null);
}
