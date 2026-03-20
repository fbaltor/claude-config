import { execFileSync } from "node:child_process";

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
// Common CLI arg parsing
// ---------------------------------------------------------------------------

export interface CommonCliArgs {
  pr: number;
  owner: string;
  repo: string;
}

/**
 * Parses --pr and --repo from argv. If --pr is absent, auto-detects from
 * the current git branch via `gh pr list`.
 */
export function parseCommonArgs(args: string[]): CommonCliArgs {
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

  // Try to detect from current branch
  try {
    const branch = execFileSync("git", ["branch", "--show-current"], {
      encoding: "utf-8",
    }).trim();
    const result = execFileSync(
      "gh",
      [
        "pr", "list",
        "--repo", `${owner}/${repo}`,
        "--head", branch,
        "--json", "number",
        "--jq", ".[0].number",
      ],
      { encoding: "utf-8" },
    ).trim();
    const n = Number(result);
    if (!Number.isNaN(n) && n > 0) return { pr: n, owner, repo };
  } catch {
    // ignore
  }

  console.error(
    "Could not detect PR number. Pass it explicitly: --pr <number>",
  );
  process.exit(1);
}
