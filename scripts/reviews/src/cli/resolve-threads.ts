#!/usr/bin/env node

/**
 * CLI entry point for resolving PR review threads.
 *
 * Usage:
 *   npx tsx src/cli/resolve-threads.ts [--pr <number>] [--reply <message>] [--all] [--thread <id>] [--list]
 *
 * If --pr is omitted, the script tries to detect the PR from the current branch.
 * Requires: `gh` CLI authenticated with repo access, or GITHUB_TOKEN env var.
 */

import { graphql } from "@octokit/graphql";
import { Octokit } from "@octokit/rest";
import { getGitHubToken, parseCommonArgs } from "../cli-utils.js";
import {
  fetchUnresolvedThreads,
  replyAndResolve,
  resolveThread,
  type UnresolvedThread,
} from "../resolve-threads.js";

// ---------------------------------------------------------------------------
// CLI arg parsing
// ---------------------------------------------------------------------------

interface ResolveCliArgs {
  pr: number;
  owner: string;
  repo: string;
  list: boolean;
  all: boolean;
  threadIds: string[];
  reply: string | null;
}

function printHelp(): never {
  console.log(`Usage: npx tsx src/cli/resolve-threads.ts [options]

Resolve (and optionally reply to) PR review threads.

Options:
  --pr <number>        PR number (auto-detects from current branch if omitted)
  --repo owner/repo    Target repository (default: Jumpstart-Immigration/jumpstart)
  --list               List all unresolved threads (no action taken)
  --all                Resolve all unresolved threads
  --thread <id>        Resolve a specific thread by GraphQL ID (repeatable)
  --reply <message>    Reply text to post before resolving
  --help               Show this help message

Examples:
  npx tsx src/cli/resolve-threads.ts --list
  npx tsx src/cli/resolve-threads.ts --all --reply "Out of scope"
  npx tsx src/cli/resolve-threads.ts --thread PRRT_abc123 --reply "Fixed"
  npx tsx src/cli/resolve-threads.ts --thread PRRT_abc --thread PRRT_def`);
  process.exit(0);
}

function parseResolveArgs(): ResolveCliArgs {
  const args = process.argv.slice(2);
  if (args.includes("--help")) printHelp();

  const common = parseCommonArgs(args);

  // Collect --thread values (repeatable)
  const threadIds: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--thread" && args[i + 1]) {
      threadIds.push(args[i + 1]);
    }
  }

  // Parse --reply
  let reply: string | null = null;
  const replyIdx = args.indexOf("--reply");
  if (replyIdx !== -1 && args[replyIdx + 1]) {
    reply = args[replyIdx + 1];
  }

  return {
    ...common,
    list: args.includes("--list"),
    all: args.includes("--all"),
    threadIds,
    reply,
  };
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

function formatThread(t: UnresolvedThread, index: number): string {
  const location = t.file ? `${t.file}${t.line ? `:${t.line}` : ""}` : "(general)";
  const preview = t.body.slice(0, 80).replace(/\n/g, " ");
  return `  ${index + 1}. [${t.reviewer}] ${location}\n     ${preview}${t.body.length > 80 ? "..." : ""}\n     ID: ${t.threadId}`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { pr, owner, repo, list, all, threadIds, reply } = parseResolveArgs();

  if (!list && !all && threadIds.length === 0) {
    console.error("Specify --list, --all, or --thread <id>. Use --help for usage.");
    process.exit(1);
  }

  const token = getGitHubToken();
  const gql = graphql.defaults({
    headers: { authorization: `token ${token}` },
  });
  const octokit = new Octokit({ auth: token });

  const threads = await fetchUnresolvedThreads(gql, owner, repo, pr);

  if (list) {
    if (threads.length === 0) {
      console.log(`PR #${pr}: No unresolved threads.`);
    } else {
      console.log(`PR #${pr}: ${threads.length} unresolved thread(s)\n`);
      for (let i = 0; i < threads.length; i++) {
        console.log(formatThread(threads[i], i));
      }
    }
    return;
  }

  // Determine which threads to resolve
  let targets: UnresolvedThread[];
  if (all) {
    targets = threads;
  } else {
    const idSet = new Set(threadIds);
    targets = threads.filter((t) => idSet.has(t.threadId));
    const found = new Set(targets.map((t) => t.threadId));
    for (const id of threadIds) {
      if (!found.has(id)) {
        console.warn(`Warning: thread ${id} not found or already resolved.`);
      }
    }
  }

  if (targets.length === 0) {
    console.log("No threads to resolve.");
    return;
  }

  console.log(`Resolving ${targets.length} thread(s) on PR #${pr}...`);

  let succeeded = 0;
  let failed = 0;
  for (const thread of targets) {
    const location = thread.file
      ? `${thread.file}${thread.line ? `:${thread.line}` : ""}`
      : "(general)";

    if (reply) {
      const result = await replyAndResolve(gql, octokit, owner, repo, pr, thread, reply);
      const replyStatus = result.replied ? "replied" : "reply skipped (404)";
      if (result.resolved) {
        console.log(`  ✓ ${location} — resolved (${replyStatus})`);
        succeeded++;
      } else {
        console.log(`  ✗ ${location} — failed: ${result.error ?? "unknown"}`);
        failed++;
      }
    } else {
      try {
        await resolveThread(gql, thread.threadId);
        console.log(`  ✓ ${location} — resolved`);
        succeeded++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`  ✗ ${location} — failed: ${msg}`);
        failed++;
      }
    }
  }

  console.log(`\nDone: ${succeeded} resolved, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

const isMainModule = process.argv[1]?.endsWith("resolve-threads.ts");
if (isMainModule) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
