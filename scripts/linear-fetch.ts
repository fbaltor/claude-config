#!/usr/bin/env npx tsx
/**
 * Linear context fetcher for Claude Code skills.
 *
 * Usage:
 *   linear-fetch.ts                              Fetch issue from current branch (falls back to usage help)
 *   linear-fetch.ts --fetch-issue JUMP-32        Fetch a specific issue by identifier
 *   linear-fetch.ts --fetch-issue <issue URL>    Fetch a specific issue by Linear URL
 *   linear-fetch.ts --fetch-issue                Fetch issue from current branch
 *   linear-fetch.ts --fetch-project <name>       Fetch project by name (fuzzy match)
 *   linear-fetch.ts --fetch-project <URL>        Fetch project by Linear URL (exact slugId match)
 *   linear-fetch.ts <free-form text>             Output minimal context (current branch + issue ID)
 *
 * Requires LINEAR_API_KEY environment variable.
 */

import {
  getClient,
  getCurrentBranch,
  parseIssueId,
  parseIssueUrl,
  parseProjectUrl,
} from "./lib/linear.ts";

async function fetchIssue(input: string): Promise<void> {
  const resolvedId = parseIssueUrl(input) ?? input.toUpperCase();
  const match = resolvedId.match(/^([A-Z]+)-(\d+)$/);
  if (!match) {
    console.log(`Invalid identifier or URL: \`${input}\``);
    return;
  }
  const [, teamKey, numberStr] = match;
  const client = getClient("read");
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

async function fetchProject(input: string): Promise<void> {
  const slugId = parseProjectUrl(input);
  const client = getClient("read");
  const projects = await client.projects({
    filter: slugId
      ? { slugId: { eq: slugId } }
      : { name: { containsIgnoreCase: input } },
    first: 1,
  });

  const project = projects.nodes[0];
  if (!project) {
    console.log(
      slugId
        ? `Project with slug ID '${slugId}' not found.`
        : `Project matching '${input}' not found.`,
    );
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
      issueId = args[idx + 1];
    } else {
      const branch = getCurrentBranch();
      issueId = branch ? parseIssueId(branch) : null;
    }

    if (issueId) {
      await fetchIssue(issueId);
    } else {
      console.error(
        "No issue ID or URL provided and could not parse from branch."
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
      console.error("No project name or URL provided.");
    }
  } else {
    const hasContent = args.some((a) => a.trim().length > 0);

    if (!hasContent) {
      // No args — try to fetch the issue from the current branch.
      // Fall back to usage help if the branch isn't Linear-derived.
      const branch = getCurrentBranch();
      const issueId = branch ? parseIssueId(branch) : null;

      if (issueId) {
        await fetchIssue(issueId);
        return;
      }

      console.log("## /linear usage\n");
      if (branch) {
        console.log(
          `_Current branch \`${branch}\` doesn't contain a Linear issue ID (e.g. \`jump-304\`, \`goj-12\`)._\n`,
        );
      } else {
        console.log("_Not in a git repository, or no current branch._\n");
      }
      console.log("| Command | What it does |");
      console.log("|---|---|");
      console.log(
        "| `/linear` | Fetch the issue parsed from the current git branch (this help shows when the branch has no Linear ID) |"
      );
      console.log(
        "| `/linear --fetch-issue <ID\\|URL>` | Fetch a specific issue by identifier (e.g. `JUMP-304`) or Linear URL |"
      );
      console.log(
        "| `/linear --fetch-project <name\\|URL>` | Fetch a project overview (state, docs, up to 50 issues) by name or Linear URL |"
      );
      console.log(
        "| `/linear <free-form request>` | Inject branch/issue context and let Claude assist using the deterministic scripts |"
      );
      console.log();
      console.log(
        "Related: `/linear-push-doc <file>` pushes a markdown doc to its linked Linear document."
      );
      return;
    }

    // Free-form — minimal context for Claude to reason over
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
