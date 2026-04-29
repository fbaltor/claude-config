import yaml from "js-yaml";
import { cleanBody } from "./body-cleaner.js";
import { getParser } from "./parsers/registry.js";
import type {
  YamlDocument,
  YamlComment,
  Reviewer,
  BotParser,
} from "./types.js";
import {
  isBot,
  isReviewBot,
  getAuthorName,
  getAuthorType,
  getThreadAuthor,
  type ReviewNode,
  type ReviewThreadNode,
  type CommentNode,
  type PrMeta,
} from "../shared.js";

/**
 * A reviewer GitHub still considers outstanding — i.e., still in
 * `pulls.listRequestedReviewers`. Surfaced separately so the YAML can show
 * pending reviews (Copilot in particular) even when the bot hasn't posted
 * any review/thread/comment yet.
 */
export interface PendingReviewer {
  login: string;
  type: "bot" | "human";
}

export interface BuildYamlInput {
  pr: number;
  owner: string;
  repo: string;
  prMeta: PrMeta;
  reviews: ReviewNode[];
  threads: ReviewThreadNode[];
  comments: CommentNode[];
  pendingReviewers?: PendingReviewer[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NULL_PARSER: BotParser = {
  parseSeverity: () => null,
  parseCategory: () => null,
  parseTitle: () => null,
  parseSuggestedFix: () => null,
  parseAiAgentPrompt: () => null,
  parseConfigNotes: () => null,
  parseDisposition: () => null,
  parseRelatedLocations: () => null,
  explodeSummary: () => [],
};

function getParserForReviewer(reviewerName: string): BotParser {
  return getParser(reviewerName) ?? NULL_PARSER;
}

function buildComment(
  id: string,
  reviewerName: string,
  type: YamlComment["type"],
  body: string,
  file: string | null,
  line: number | null,
  lineRange: [number, number] | null,
  isOutdated: boolean,
): YamlComment {
  const parser = getParserForReviewer(reviewerName);
  return {
    id,
    reviewer: reviewerName,
    type,
    disposition: parser.parseDisposition(body),
    file,
    line,
    line_range: lineRange,
    severity: parser.parseSeverity(body),
    category: parser.parseCategory(body),
    title: parser.parseTitle(body),
    body: cleanBody(body, reviewerName),
    suggested_fix: parser.parseSuggestedFix(body),
    code_snippet: null,
    ai_agent_prompt: parser.parseAiAgentPrompt(body),
    related_locations: parser.parseRelatedLocations(body),
    is_outdated: isOutdated,
  };
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export function buildYamlOutput(input: BuildYamlInput): string {
  const { pr, owner, repo, prMeta, reviews, threads, comments } = input;
  const pendingReviewers = input.pendingReviewers ?? [];

  // 1. Build PR metadata
  const prMetadata = {
    number: pr,
    title: prMeta.title,
    url: prMeta.url,
    author: prMeta.author,
    base: prMeta.baseRefName,
    head: prMeta.headRefName,
    created_at: prMeta.createdAt,
    files_changed: prMeta.changedFiles,
  };

  // 2. Build reviewers list.
  //
  // A "reviewer" is anyone who has actually reviewed (a review submission, an
  // inline thread, or — for humans only — a general PR comment) plus anyone
  // GitHub still considers an outstanding reviewer (pendingReviewers, sourced
  // from pulls.listRequestedReviewers in the CLI).
  //
  // General-comment-only bots (linear[bot] link-backs, vercel[bot] deploy
  // status, etc.) are deliberately filtered: they leave PR comments but are
  // not code reviewers, and listing them as reviewers misleads the triage
  // skill about who is actually reviewing the PR.
  const reviewerSet = new Map<string, "bot" | "human">();
  for (const r of reviews) {
    reviewerSet.set(getAuthorName(r.author), getAuthorType(r.author));
  }
  for (const t of threads) {
    const firstAuthor = t.comments.nodes[0]?.author ?? null;
    reviewerSet.set(getAuthorName(firstAuthor), getAuthorType(firstAuthor));
  }
  for (const c of comments) {
    if (isBot(c.author) && !isReviewBot(c.author)) continue;
    reviewerSet.set(getAuthorName(c.author), getAuthorType(c.author));
  }

  const pendingSet = new Set<string>();
  for (const p of pendingReviewers) {
    const name = p.login.replace("[bot]", "");
    if (!reviewerSet.has(name)) {
      reviewerSet.set(name, p.type);
    }
    pendingSet.add(name);
  }

  const reviewers: Reviewer[] = [];
  for (const [reviewerName, reviewerType] of reviewerSet) {
    const parser = getParserForReviewer(reviewerName);
    // Only extract config_notes for bots (humans don't have structured config)
    let configNotes: string | null = null;
    if (reviewerType === "bot") {
      const summaryComment = comments.find(
        (c) => getAuthorName(c.author) === reviewerName && c.body.length > 200,
      );
      configNotes = summaryComment
        ? parser.parseConfigNotes(summaryComment.body)
        : null;
    }

    reviewers.push({
      id: reviewerName,
      display_name: reviewerName,
      type: reviewerType,
      status: pendingSet.has(reviewerName) ? "pending" : "reviewed",
      config_notes: configNotes,
    });
  }

  // 3. Build flat comments list
  const yamlComments: YamlComment[] = [];

  // 3a. Reviews with body
  for (const review of reviews) {
    const reviewerName = getAuthorName(review.author);
    const parser = getParserForReviewer(reviewerName);

    if (!review.body) continue;

    const exploded = parser.explodeSummary(review.id, review.body, null);
    if (exploded.length > 0) {
      const reviewAiPrompt = parser.parseAiAgentPrompt(review.body);
      for (const item of exploded) {
        yamlComments.push({
          id: item.id,
          reviewer: reviewerName,
          type: "review_summary",
          disposition: null,
          file: item.file,
          line: item.line,
          line_range: null,
          severity: item.severity,
          category: item.category,
          title: item.title,
          body: cleanBody(item.body, reviewerName),
          suggested_fix: item.suggested_fix,
          code_snippet: null,
          ai_agent_prompt: reviewAiPrompt,
          related_locations: null,
          is_outdated: false,
        });
      }
    } else {
      yamlComments.push(
        buildComment(review.id, reviewerName, "review_summary", review.body, null, null, null, false),
      );
    }
  }

  // 3b. Inline threads — attribute to first commenter (human or bot)
  for (const thread of threads) {
    const firstComment = thread.comments.nodes[0];
    if (!firstComment) continue;

    const reviewerName = getAuthorName(firstComment.author);

    let lineRange: [number, number] | null = null;
    if (thread.line != null) {
      const start = thread.startLine ?? thread.line;
      lineRange = [start, thread.line];
    }

    yamlComments.push(
      buildComment(
        firstComment.id,
        reviewerName,
        "inline",
        firstComment.body,
        thread.path,
        thread.line,
        lineRange,
        thread.isOutdated,
      ),
    );
  }

  // 3c. General PR comments — skip non-review bots (linear/vercel/etc.) so
  // their link-back / deploy-status posts don't end up classified as
  // "general" review comments.
  for (const comment of comments) {
    if (isBot(comment.author) && !isReviewBot(comment.author)) continue;
    const reviewerName = getAuthorName(comment.author);
    yamlComments.push(
      buildComment(comment.id, reviewerName, "general", comment.body, null, null, null, false),
    );
  }

  // 4. Serialize
  const doc: YamlDocument = {
    schema: "pr-review-comments",
    schema_version: "1.0",
    pr: prMetadata,
    reviewers,
    comments: yamlComments,
  };

  return yaml.dump(doc, {
    lineWidth: 120,
    noRefs: true,
    quotingType: '"',
    forceQuotes: false,
  });
}
