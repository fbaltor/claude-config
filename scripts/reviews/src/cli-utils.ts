import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { Octokit } from "@octokit/rest";

export const DEFAULT_OWNER = "Jumpstart-Immigration";
export const DEFAULT_REPO = "jumpstart";

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export function getGitHubToken(): string {
  const envToken = process.env["GITHUB_TOKEN"];
  if (envToken) return envToken;

  try {
    return execFileSync("gh", ["auth", "token"], { encoding: "utf-8" }).trim();
  } catch {
    console.error(
      "No GITHUB_TOKEN env var and `gh auth token` failed. Please authenticate.",
    );
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Local branch detection (fs-based — no `git` shell-out)
// ---------------------------------------------------------------------------

/**
 * Walks up from `startDir` looking for a `.git` entry. Returns the resolved
 * git directory — which for a worktree is the worktree-specific dir under
 * `<main>/.git/worktrees/<name>`, following the `gitdir:` pointer.
 */
function resolveGitDir(startDir: string): string | null {
  let dir = resolve(startDir);
  while (true) {
    const candidate = join(dir, ".git");
    if (existsSync(candidate)) {
      if (statSync(candidate).isDirectory()) return candidate;
      const match = readFileSync(candidate, "utf-8").trim().match(/^gitdir:\s*(.+)$/);
      if (match) {
        const pointer = match[1].trim();
        return isAbsolute(pointer) ? pointer : resolve(dir, pointer);
      }
      return null;
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Reads the current branch name by parsing `HEAD` directly. Returns `null`
 * when the caller isn't in a git repo, or HEAD is detached.
 */
export function readCurrentBranch(startDir: string): string | null {
  const gitDir = resolveGitDir(startDir);
  if (!gitDir) return null;
  const headPath = join(gitDir, "HEAD");
  if (!existsSync(headPath)) return null;
  const head = readFileSync(headPath, "utf-8").trim();
  const match = head.match(/^ref:\s*refs\/heads\/(.+)$/);
  return match ? match[1].trim() : null;
}

// ---------------------------------------------------------------------------
// Common CLI arg parsing
// ---------------------------------------------------------------------------

export interface CommonCliArgs {
  pr: number;
  owner: string;
  repo: string;
}

/**
 * Parses --pr and --repo from argv. If --pr is absent, auto-detects from
 * the current git branch via the GitHub REST API.
 */
export async function parseCommonArgs(args: string[]): Promise<CommonCliArgs> {
  // Parse --repo
  let owner = DEFAULT_OWNER;
  let repo = DEFAULT_REPO;
  const repoIdx = args.indexOf("--repo");
  if (repoIdx !== -1 && args[repoIdx + 1]) {
    const parts = args[repoIdx + 1].split("/");
    if (parts.length === 2 && parts[0] && parts[1]) {
      owner = parts[0];
      repo = parts[1];
    } else {
      console.error("Invalid --repo format. Expected: owner/repo");
      process.exit(1);
    }
  }

  // Parse --pr
  const prIdx = args.indexOf("--pr");
  if (prIdx !== -1) {
    const raw = args[prIdx + 1];
    const n = raw ? Number(raw) : NaN;
    if (!Number.isInteger(n) || n <= 0) {
      console.error(`Invalid --pr value: ${raw ?? "(missing)"}. Expected a positive integer.`);
      process.exit(1);
    }
    return { pr: n, owner, repo };
  }

  // pnpm run rewrites cwd to the package dir but preserves the caller's cwd
  // in INIT_CWD — use it so branch detection works when invoked via
  // `pnpm --dir ... run`.
  const callerCwd = process.env["INIT_CWD"] ?? process.cwd();
  const branch = readCurrentBranch(callerCwd);
  if (!branch) {
    console.error(
      `Could not detect PR number — no branch found for ${callerCwd} ` +
        `(detached HEAD or not a git repo). Pass it explicitly: --pr <number>`,
    );
    process.exit(1);
  }

  const head = `${owner}:${branch}`;
  try {
    const octokit = new Octokit({ auth: getGitHubToken() });
    const { data } = await octokit.pulls.list({
      owner,
      repo,
      head,
      state: "open",
      per_page: 1,
    });
    if (data[0]) return { pr: data[0].number, owner, repo };
  } catch (err) {
    console.error(
      `Could not detect PR number — GitHub API error while looking up ` +
        `${owner}/${repo} head=${head}: ${(err as Error).message}. ` +
        `Pass it explicitly: --pr <number>`,
    );
    process.exit(1);
  }

  console.error(
    `Could not detect PR number — no open PR found for ${owner}/${repo} ` +
      `head=${head}. Pass it explicitly: --pr <number>`,
  );
  process.exit(1);
}
