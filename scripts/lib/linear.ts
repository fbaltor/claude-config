/**
 * Shared Linear utilities for Claude Code scripts and hooks.
 */

import { LinearClient } from "@linear/sdk";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export function getClient(scope: "read" | "write"): LinearClient {
  const envVar = scope === "write" ? "LINEAR_API_KEY_ALL" : "LINEAR_API_KEY_READ";
  const apiKey = process.env[envVar] ?? process.env.LINEAR_API_KEY;
  if (!apiKey) {
    throw new Error(`${envVar} (or LINEAR_API_KEY) not set.`);
  }
  return new LinearClient({ apiKey });
}

// ---------------------------------------------------------------------------
// Frontmatter
// ---------------------------------------------------------------------------

export interface Frontmatter {
  data: Record<string, string>;
  body: string;
}

export function parseFrontmatter(content: string): Frontmatter {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { data: {}, body: content };

  const data: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx > 0) {
      data[line.slice(0, colonIdx).trim()] = line.slice(colonIdx + 1).trim();
    }
  }
  return { data, body: match[2].replace(/^\n/, "") };
}

export function buildFrontmatter(data: Record<string, string>, body: string): string {
  const lines = Object.entries(data).map(([k, v]) => `${k}: ${v}`);
  return `---\n${lines.join("\n")}\n---\n\n${body}`;
}

// ---------------------------------------------------------------------------
// Sync banner (prepended to Linear documents to indicate git is source of truth)
// ---------------------------------------------------------------------------

const SYNC_BANNER_PATTERN = /^> \*\*Source of truth:\*\*[^\n]*\n\n---\n\n/;

export function buildSyncBanner(filePath: string): string {
  const repoUrl = `https://github.com/Jumpstart-Immigration/jumpstart/blob/main/${filePath}`;
  return (
    `> **Source of truth:** [\`${filePath}\`](${repoUrl}) in the \`jumpstart\` repo. ` +
    `This Linear document is auto-synced — edit the git version first.\n\n---\n\n`
  );
}

export function stripSyncBanner(content: string): string {
  return content.replace(SYNC_BANNER_PATTERN, "");
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

export function getCurrentBranch(): string | null {
  try {
    return execSync("git branch --show-current", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

export function parseIssueId(branch: string): string | null {
  const match = branch.match(/(jump|goj)-\d+/i);
  return match ? match[0].toUpperCase() : null;
}

/**
 * Return the set of file paths changed on the current branch vs the merge base with main.
 */
export function getChangedFilesOnBranch(cwd: string): Set<string> {
  try {
    const mergeBase = execSync("git merge-base HEAD main", {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
    }).trim();
    const output = execSync(`git diff --name-only ${mergeBase}..HEAD`, {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
    });
    return new Set(output.trim().split("\n").filter(Boolean));
  } catch {
    return new Set();
  }
}

// ---------------------------------------------------------------------------
// Sync hash — tracks whether local content has changed since last push/pull
// ---------------------------------------------------------------------------

/**
 * Compute a truncated SHA-256 hash of the body content.
 * Used to detect local changes without fetching from Linear.
 */
export function computeSyncHash(body: string): string {
  const normalized = body.trim().replace(/\r\n/g, "\n");
  return createHash("sha256").update(normalized, "utf-8").digest("hex").slice(0, 12);
}

// ---------------------------------------------------------------------------
// Document sync check
// ---------------------------------------------------------------------------

export interface SyncedDoc {
  filePath: string;
  docId: string;
}

/**
 * Find all markdown files under `cwd` that have a `linear_document_id` in frontmatter.
 */
export function findLinearLinkedDocs(cwd: string): SyncedDoc[] {
  let files: string[];
  try {
    const output = execSync("grep -rl 'linear_document_id:' --include='*.md' .", {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
    });
    files = output.trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }

  const docs: SyncedDoc[] = [];
  for (const rel of files) {
    const abs = resolve(cwd, rel);
    if (!existsSync(abs)) continue;
    const raw = readFileSync(abs, "utf-8");
    const { data } = parseFrontmatter(raw);
    if (data.linear_document_id) {
      docs.push({ filePath: rel.replace(/^\.\//, ""), docId: data.linear_document_id });
    }
  }
  return docs;
}

/**
 * Check if a local file is in sync with its Linear document.
 * Compares the current body hash against `linear_sync_hash` in frontmatter.
 * Returns null if in sync, or a description string if out of sync.
 */
export function checkDocSync(
  cwd: string,
  doc: SyncedDoc,
): string | null {
  const absPath = resolve(cwd, doc.filePath);
  if (!existsSync(absPath)) return `${doc.filePath}: file not found locally`;

  const raw = readFileSync(absPath, "utf-8");
  const { data, body } = parseFrontmatter(raw);

  const storedHash = data.linear_sync_hash;
  if (!storedHash) return `${doc.filePath} (doc: ${doc.docId}, never synced)`;

  const currentHash = computeSyncHash(body);
  if (currentHash !== storedHash) {
    return `${doc.filePath} (doc: ${doc.docId})`;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Issue resolution
// ---------------------------------------------------------------------------

/**
 * Resolve an issue identifier (e.g., "JUMP-247") to its UUID.
 */
export async function resolveIssueId(identifier: string): Promise<string | null> {
  const match = identifier.match(/^([A-Z]+)-(\d+)$/);
  if (!match) return null;

  const [, teamKey, numberStr] = match;
  const client = getClient("read");

  const result = await client.issues({
    filter: {
      team: { key: { eq: teamKey } },
      number: { eq: parseInt(numberStr, 10) },
    },
    first: 1,
  });

  return result.nodes[0]?.id ?? null;
}

// ---------------------------------------------------------------------------
// Issue status update
// ---------------------------------------------------------------------------

/**
 * Update a Linear issue's status by identifier (e.g., "JUMP-36").
 */
export async function updateIssueStatus(
  identifier: string,
  statusName: string,
): Promise<{ success: boolean; message: string }> {
  const match = identifier.match(/^([A-Z]+)-(\d+)$/);
  if (!match) return { success: false, message: `Invalid identifier: ${identifier}` };

  const [, teamKey, numberStr] = match;
  const client = getClient("write");

  // Find the issue
  const result = await client.issues({
    filter: {
      team: { key: { eq: teamKey } },
      number: { eq: parseInt(numberStr, 10) },
    },
    first: 1,
  });

  const issue = result.nodes[0];
  if (!issue) return { success: false, message: `Issue ${identifier} not found` };

  // Find the target status
  const team = await issue.team;
  if (!team) return { success: false, message: `Team not found for ${identifier}` };

  const states = await team.states();
  const targetState = states.nodes.find(
    (s) => s.name.toLowerCase() === statusName.toLowerCase(),
  );
  if (!targetState) {
    const available = states.nodes.map((s) => s.name).join(", ");
    return { success: false, message: `Status "${statusName}" not found. Available: ${available}` };
  }

  await issue.update({ stateId: targetState.id });
  return { success: true, message: `${identifier} → ${targetState.name}` };
}
