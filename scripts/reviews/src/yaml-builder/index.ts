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
  getAuthorName,
  getAuthorType,
  getThreadAuthor,
  type ReviewNode,
  type ReviewThreadNode,
  type CommentNode,
  type PrMeta,
} from "../shared.js";

export interface BuildYamlInput {
  pr: number;
  owner: string;
  repo: string;
  prMeta: PrMeta;
  reviews: ReviewNode[];
  threads: ReviewThreadNode[];
  comments: CommentNode[];
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

  // 2. Build reviewers list (human + bot)
  const reviewerSet = new Map<string, "bot" | "human">();
  for (const r of reviews) {
    const name = getAuthorName(r.author);
    reviewerSet.set(name, getAuthorType(r.author));
  }
  for (const t of threads) {
    const firstAuthor = t.comments.nodes[0]?.author ?? null;
    const name = getAuthorName(firstAuthor);
    reviewerSet.set(name, getAuthorType(firstAuthor));
  }
  for (const c of comments) {
    const name = getAuthorName(c.author);
    reviewerSet.set(name, getAuthorType(c.author));
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

  // 3c. General PR comments
  for (const comment of comments) {
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
