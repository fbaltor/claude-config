// Public API
export {
  type Author,
  type ReviewNode,
  type ReviewThreadNode,
  type ReviewThreadCommentNode,
  type CommentNode,
  type PrMeta,
  type ReviewerData,
  isBot,
  getAuthorName,
  getAuthorType,
  isReviewBot,
  getThreadAuthor,
  AI_REVIEWERS,
} from "./shared.js";

export {
  type ReviewFilter,
  type JsonSidecar,
  matchesFilter,
  groupByReviewer,
  collectByReviewer,
  buildJsonSidecar,
  buildByReviewerMarkdown,
  checkNestedTruncation,
  fetchAllReviews,
  fetchAllReviewThreads,
  fetchAllComments,
} from "./fetch-reviews.js";

export {
  type AiCheckRun,
  type CheckStatusResult,
  type WaitOptions,
  fetchAiCheckRuns,
  getCheckStatus,
  isFailedCheck,
  rerunFailedChecks,
  waitForCompletion,
} from "./check-reviews.js";

export {
  type StatusRenderer,
  createRenderer,
  createNoopRenderer,
} from "./check-reviews-renderer.js";

export {
  type BuildYamlInput,
  buildYamlOutput,
} from "./yaml-builder/index.js";

export {
  type UnresolvedThread,
  type ResolveResult,
  fetchUnresolvedThreads,
  replyToComment,
  resolveThread,
  replyAndResolve,
} from "./resolve-threads.js";

export {
  type CiAnnotation,
  type CiStep,
  type CiFailure,
  type CiFailureReport,
  fetchFailedCiChecks,
  fetchCiFailureDetails,
  extractFailedStepLog,
  buildCiFailureYaml,
} from "./ci-checks.js";

export { getGitHubToken, parseCommonArgs } from "./cli-utils.js";
