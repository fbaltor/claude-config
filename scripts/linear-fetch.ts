#!/usr/bin/env npx tsx
/**
 * Linear context fetcher for Claude Code skills.
 *
 * Usage:
 *   linear-fetch.ts --fetch-issue JUMP-32     Fetch a specific issue
 *   linear-fetch.ts --fetch-issue             Fetch issue from current branch
 *   linear-fetch.ts --fetch-project <name>    Fetch project overview with issues & docs
 *   linear-fetch.ts <anything else>           Output minimal context (current branch + issue ID)
 *
 * Requires LINEAR_API_KEY environment variable.
 */

import { LinearClient } from "@linear/sdk";
import { execSync } from "node:child_process";

function getClient(): LinearClient {
  const apiKey = process.env.LINEAR_API_KEY_READ ?? process.env.LINEAR_API_KEY;
  if (!apiKey) {
    console.error("LINEAR_API_KEY_READ (or LINEAR_API_KEY) not set.");
    process.exit(1);
  }
  return new LinearClient({ apiKey });
}

function getCurrentBranch(): string | null {
  try {
    return execSync("git branch --show-current", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function parseIssueId(branch: string): string | null {
  const match = branch.match(/(jump|goj)-\d+/i);
  return match ? match[0].toUpperCase() : null;
}

async function fetchIssue(identifier: string): Promise<void> {
  const client = getClient();
  const match = identifier.match(/^([A-Z]+)-(\d+)$/);
  if (!match) {
    console.log(`Invalid identifier format: \`${identifier}\``);
    return;
  }
  const [, teamKey, numberStr] = match;
  const result = await client.issues({
    filter: {
      team: { key: { eq: teamKey } },
      number: { eq: parseInt(numberStr, 10) },
    },
    first: 1,
  });

  const issue = result.nodes[0];
  if (!issue) {
    console.log(`Issue \`${identifier}\` not found.`);
    return;
  }

  const state = await issue.state;
  const assignee = await issue.assignee;
  const project = await issue.project;
  const labelNodes = await issue.labels();

  const labels = labelNodes.nodes.map((l) => l.name).join(", ") || "None";

  console.log(`## ${issue.identifier}: ${issue.title}`);
  console.log(`**Status:** ${state?.name ?? "Unknown"}  `);
  console.log(`**Priority:** ${issue.priority ?? "None"}  `);
  console.log(`**Assignee:** ${assignee?.name ?? "Unassigned"}  `);
  console.log(`**Labels:** ${labels}  `);
  console.log(`**Project:** ${project?.name ?? "N/A"}  `);
  console.log(`**URL:** ${issue.url}`);
  console.log();
  console.log(issue.description ?? "No description.");
}

async function fetchProject(name: string): Promise<void> {
  const client = getClient();
  const projects = await client.projects({
    filter: { name: { containsIgnoreCase: name } },
    first: 1,
  });

  const project = projects.nodes[0];
  if (!project) {
    console.log(`Project matching '${name}' not found.`);
    return;
  }

  console.log(`## Project: ${project.name}`);
  console.log(`**State:** ${project.state}  `);
  console.log(`**URL:** ${project.url}`);

  const docs = await project.documents();
  if (docs.nodes.length > 0) {
    console.log("\n### Documents");
    for (const doc of docs.nodes) {
      console.log(`- [${doc.title}](${doc.url})`);
    }
  }

  const issues = await project.issues({ first: 50 });
  if (issues.nodes.length > 0) {
    console.log("\n### Issues");
    for (const issue of issues.nodes) {
      const state = await issue.state;
      console.log(
        `- **${issue.identifier}** (${state?.name}): ${issue.title}`
      );
    }
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes("--fetch-issue")) {
    const idx = args.indexOf("--fetch-issue");
    let issueId: string | null = null;

    if (idx + 1 < args.length && !args[idx + 1].startsWith("--")) {
      issueId = args[idx + 1].toUpperCase();
    } else {
      const branch = getCurrentBranch();
      issueId = branch ? parseIssueId(branch) : null;
    }

    if (issueId) {
      await fetchIssue(issueId);
    } else {
      console.error(
        "No issue ID provided and could not parse from branch."
      );
    }
  } else if (args.includes("--fetch-project")) {
    const idx = args.indexOf("--fetch-project");
    const parts: string[] = [];
    for (const a of args.slice(idx + 1)) {
      if (a.startsWith("--")) break;
      parts.push(a);
    }

    if (parts.length > 0) {
      await fetchProject(parts.join(" "));
    } else {
      console.error("No project name provided.");
    }
  } else {
    // No recognized flag — minimal context
    const branch = getCurrentBranch();
    if (branch) {
      const issueId = parseIssueId(branch);
      if (issueId) {
        console.log(`**Current branch:** \`${branch}\` (issue: \`${issueId}\`)`);
      } else {
        console.log(`**Current branch:** \`${branch}\``);
      }
    }
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
