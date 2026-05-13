#!/usr/bin/env node

/**
 * CLI entry point for fetching PR review comments.
 *
 * Usage:
 *   npx tsx src/cli/fetch-reviews.ts --pr <number>
 *
 * If --pr is omitted, the script tries to detect the PR from the current branch.
 * Requires: `gh` CLI authenticated with repo access, or GITHUB_TOKEN env var.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { graphql } from "@octokit/graphql";
import { Octokit } from "@octokit/rest";
import { getGitHubToken, parseCommonArgs } from "../cli-utils.js";
import { waitForCompletion } from "../check-reviews.js";
import { buildCiFailureYaml } from "../ci-checks.js";
import { buildYamlOutput, type PendingReviewer } from "../yaml-builder/index.js";
import {
  AI_REVIEWER_REQUESTED_LOGINS,
  getAuthorName,
  getAuthorType,
  type ReviewThreadNode,
} from "../shared.js";
import {
  type ReviewFilter,
  matchesFilter,
  groupByReviewer,
  collectByReviewer,
  buildJsonSidecar,
  buildByReviewerMarkdown,
  checkNestedTruncation,
  fetchAllReviews,
  fetchAllReviewThreads,
  fetchAllComments,
} from "../fetch-reviews.js";

// ---------------------------------------------------------------------------
// CLI arg parsing
// ---------------------------------------------------------------------------

type OutputFormat = "yaml" | "md" | "by-reviewer" | "json";

interface CliArgs {
  pr: number;
  owner: string;
  repo: string;
  wait: boolean;
  rerun: boolean;
  skipCi: boolean;
  filter: ReviewFilter;
  formats: Set<OutputFormat>;
}

function printHelp(): never {
  console.log(`Usage: npx tsx src/cli/fetch-reviews.ts [options]

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
  --skip-ci          Skip CI failure detection during --wait (proceed even if CI is red)
  --format <list>    Comma-separated output formats: yaml,md,by-reviewer,json (default: yaml)
  --format all       Enable all output formats
  --help             Show this help message

Requires: gh CLI authenticated with repo access, or GITHUB_TOKEN env var.

Examples:
  npx tsx src/cli/fetch-reviews.ts --pr 39
  npx tsx src/cli/fetch-reviews.ts --bot --pr 39
  npx tsx src/cli/fetch-reviews.ts --wait --pr 39`);
  process.exit(0);
}

async function parseArgs(): Promise<CliArgs> {
  const args = process.argv.slice(2);
  if (args.includes("--help")) printHelp();

  const common = await parseCommonArgs(args);

  let filter: ReviewFilter = "all";
  if (args.includes("--bot")) filter = "bot";
  else if (args.includes("--human")) filter = "human";

  // Parse --format (default: yaml only)
  const ALL_FORMATS: OutputFormat[] = ["yaml", "md", "by-reviewer", "json"];
  let formats = new Set<OutputFormat>(["yaml"]);
  const formatIdx = args.indexOf("--format");
  if (formatIdx !== -1 && args[formatIdx + 1]) {
    const raw = args[formatIdx + 1];
    if (raw === "all") {
      formats = new Set(ALL_FORMATS);
    } else {
      formats = new Set(
        raw.split(",").filter((f): f is OutputFormat => ALL_FORMATS.includes(f as OutputFormat)),
      );
      if (formats.size === 0) formats.add("yaml");
    }
  }

  return {
    ...common,
    wait: args.includes("--wait"),
    rerun: args.includes("--rerun"),
    skipCi: args.includes("--skip-ci"),
    filter,
    formats,
  };
}

// ---------------------------------------------------------------------------
// Pending reviewers
// ---------------------------------------------------------------------------

/**
 * Reviewers GitHub still considers outstanding (in `requested_reviewers`).
 * Bots are filtered to known AI review apps so noise bots don't sneak back in
 * via the requested-reviewers list either; humans are passed through as-is.
 */
async function fetchPendingReviewers(
  octokit: Octokit,
  owner: string,
  repo: string,
  pr: number,
): Promise<PendingReviewer[]> {
  const { data } = await octokit.pulls.listRequestedReviewers({
    owner,
    repo,
    pull_number: pr,
  });

  const out: PendingReviewer[] = [];
  for (const user of data.users ?? []) {
    const isBotUser = user.type === "Bot";
    if (isBotUser && !AI_REVIEWER_REQUESTED_LOGINS[user.login]) continue;
    out.push({ login: user.login, type: isBotUser ? "bot" : "human" });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { pr, owner, repo, wait, rerun, skipCi, filter, formats } = await parseArgs();

  const token = getGitHubToken();
  const octokit = new Octokit({ auth: token });

  // If --wait, delegate to status checker first
  if (wait) {
    console.log(`Checking AI review status for PR #${pr}...`);
    if (skipCi) console.log("--skip-ci: CI failure detection disabled.");
    const result = await waitForCompletion(octokit, owner, repo, pr, { rerun, checkCi: !skipCi });

    // CI failure detected — write failure report and abort
    if (result.ciFailures && result.ciFailures.length > 0) {
      const failNames = result.ciFailures.map((f) => f.job_name).join(", ");
      console.error(`\nCI check failed: ${failNames}`);
      console.error("Fix CI before triaging reviews.\n");

      const outDir = join(process.cwd(), ".pr-reviews");
      mkdirSync(outDir, { recursive: true });
      const ciYaml = buildCiFailureYaml(result.ciFailures);
      const ciPath = join(outDir, `pr-${pr}-ci-failure.yaml`);
      writeFileSync(ciPath, ciYaml, "utf-8");

      console.log(`ci-failure: ${ciPath}`);
      process.exit(1);
    }

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

  const [
    { prMeta, reviews: allReviews },
    allThreads,
    allComments,
    pendingReviewers,
  ] = await Promise.all([
    fetchAllReviews(gql, owner, repo, pr),
    fetchAllReviewThreads(gql, owner, repo, pr),
    fetchAllComments(gql, owner, repo, pr),
    fetchPendingReviewers(octokit, owner, repo, pr),
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

  // Write outputs
  const outDir = join(process.cwd(), ".pr-reviews");
  mkdirSync(outDir, { recursive: true });

  const savedPaths: Record<string, string> = {};

  if (formats.has("md")) {
    const outPath = join(outDir, `pr-${pr}-reviews-${timestamp}.md`);
    writeFileSync(outPath, lines.join("\n"), "utf-8");
    savedPaths.md = outPath;
  }

  if (formats.has("by-reviewer") || formats.has("json")) {
    // Both by-reviewer and json need the reviewerMap
    var reviewerMap = collectByReviewer(reviews, filteredThreads, prComments);

    if (formats.has("by-reviewer")) {
      const byReviewerContent = buildByReviewerMarkdown(
        pr, prMeta.title, prMeta.url, isoString, reviewerMap,
      );
      const byReviewerPath = join(outDir, `pr-${pr}-reviews-${timestamp}-by-reviewer.md`);
      writeFileSync(byReviewerPath, byReviewerContent, "utf-8");
      savedPaths["by-reviewer"] = byReviewerPath;
    }

    if (formats.has("json")) {
      const sidecar = buildJsonSidecar(
        pr, `${owner}/${repo}`, prMeta.title, prMeta.url, isoString, reviewerMap, filteredThreads,
      );
      const jsonPath = join(outDir, `pr-${pr}-reviews-${timestamp}.json`);
      writeFileSync(jsonPath, JSON.stringify(sidecar, null, 2), "utf-8");
      savedPaths.json = jsonPath;
    }
  }

  if (formats.has("yaml")) {
    const yamlContent = buildYamlOutput({
      pr, owner, repo, prMeta, reviews, threads: filteredThreads, comments: prComments,
      pendingReviewers,
    });
    const yamlPath = join(outDir, `pr-${pr}-reviews-${timestamp}.yaml`);
    writeFileSync(yamlPath, yamlContent, "utf-8");
    savedPaths.yaml = yamlPath;
  }

  // Print parseable output paths (one per line, key: path)
  console.log("");
  for (const [key, path] of Object.entries(savedPaths)) {
    console.log(`${key}: ${path}`);
  }
}

const isMainModule = process.argv[1]?.endsWith("fetch-reviews.ts");
if (isMainModule) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
