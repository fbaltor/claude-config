#!/usr/bin/env -S npx tsx
//
// branch-window entry point.
//
// Forks the current Claude Code conversation (native --fork-session) and opens
// the fork in a new terminal surface chosen by a pluggable backend. The current
// session is left untouched.
//
// Usage:
//   branch.ts <prompt> [--name <label>] [--backend <name>] [--split h|v]
//
//   prompt      REQUIRED. Opening message for the fork. The CLI cannot resume a
//               fork idle, so this becomes the fork's first turn; the window
//               then stays interactive for continued chat.
//   --name      optional label shown in the forked session's prompt box
//   --backend   force a backend (ghostty|tmux|wezterm|kitty); default = auto
//   --split     h (side-by-side) or v (stacked); pane backends only
//
// Requires CLAUDE_CODE_SESSION_ID in the environment (always set inside CC).
// Claude Code overrides it with the live session's id even inside a fork that
// inherited a stale value, so it is reliable here — the old "branch-of-a-branch
// forks the grandparent" bug was a 2.1.158 artifact, fixed by 2.1.16x. (For a
// deterministic hedge against a future regression, fall back to the per-pid
// session registry ~/.claude/sessions/<claude-pid>.json — never to mtime.)

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Split, SpawnCtx } from "./lib/types.ts";
import { select } from "./lib/select.ts";

// Used as the fork's opening turn when the user passes no prompt. Phrased so the
// forked Claude just acknowledges and waits — it opens the branch idle-ish
// without continuing prior work. (A real prompt is required by the CLI; empty or
// whitespace prompts are rejected.)
const NOOP_PROMPT =
  "(You are a forked session opened via branch-window with no task. " +
  "Do not continue any prior work or take any action. Reply with a single " +
  "word and wait for the user.)";

interface Args {
  prompt?: string;
  name?: string;
  backend?: string;
  split?: Split;
}

export function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--name") {
      args.name = argv[++i];
    } else if (a === "--backend") {
      args.backend = argv[++i];
    } else if (a === "--split") {
      const v = argv[++i];
      if (v !== "h" && v !== "v") {
        throw new Error(`--split must be h or v (got "${v}")`);
      }
      args.split = v;
    } else if (a.startsWith("--")) {
      throw new Error(`unknown flag "${a}"`);
    } else if (!args.prompt) {
      args.prompt = a;
    } else {
      throw new Error(`unexpected argument "${a}" (quote multi-word prompts)`);
    }
  }
  return args;
}

/** Resolve the `claude` binary: prefer the exec path CC exports, else PATH. */
export function resolveClaudeBin(env: NodeJS.ProcessEnv): string {
  const exec = env.CLAUDE_CODE_EXECPATH;
  if (exec && existsSync(exec)) return exec;

  const path = env.PATH ?? "";
  for (const dir of path.split(":")) {
    if (!dir) continue;
    const cand = join(dir, "claude");
    if (existsSync(cand)) return cand;
  }
  throw new Error("could not locate the `claude` binary (CLAUDE_CODE_EXECPATH unset and not on PATH)");
}

/**
 * Resolve the cwd the fork must launch in so `claude --resume <sessionId>` can
 * find the transcript.
 *
 * CC files a session's transcript under the project slug derived from the cwd
 * the session STARTED in. A session that `cd`'d mid-run therefore has its
 * transcript under the start cwd's slug, which need not equal process.cwd().
 * Launching the fork in the wrong cwd makes `--resume` compute a different slug
 * and fail with "No conversation found".
 *
 * Locate `<sessionId>.jsonl` under `projectsRoot` and return the cwd of its
 * first cwd-bearing record (the start cwd that owns the slug). Head records
 * (last-prompt/mode/permission-mode) carry no cwd and must be skipped. Returns
 * `fallback` (caller passes process.cwd()) when no transcript or no cwd record
 * is found, and never throws on a missing root or malformed JSON lines.
 *
 * @param sessionId    session being forked
 * @param fallback     cwd to use when resolution fails (process.cwd())
 * @param projectsRoot CC projects dir; param exists for hermetic tests
 */
export function resolveForkCwd(
  sessionId: string,
  fallback: string,
  projectsRoot: string = join(homedir(), ".claude", "projects"),
): string {
  let slugs: string[];
  try {
    slugs = readdirSync(projectsRoot);
  } catch {
    return fallback; // root missing/unreadable
  }
  for (const slug of slugs) {
    const file = join(projectsRoot, slug, `${sessionId}.jsonl`);
    if (!existsSync(file)) continue;
    let content: string;
    try {
      content = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const line of content.split("\n")) {
      if (!line) continue;
      let rec: { cwd?: unknown };
      try {
        rec = JSON.parse(line);
      } catch {
        continue; // skip malformed/partial line
      }
      // First cwd-bearing record is the session's start cwd, whose slug owns
      // this transcript. Head records (last-prompt/mode/permission-mode) have
      // no cwd and are skipped.
      if (typeof rec.cwd === "string" && rec.cwd) return rec.cwd;
    }
    // file found but no cwd record anywhere — fall through to fallback
  }
  return fallback;
}

function main(): void {
  const env = process.env;

  const sessionId = env.CLAUDE_CODE_SESSION_ID;
  if (!sessionId) {
    throw new Error("CLAUDE_CODE_SESSION_ID is not set — run this from inside Claude Code");
  }

  const args = parseArgs(process.argv.slice(2));

  // The CLI can't open a fork idle — a prompt is mandatory (it becomes the
  // fork's first turn). When the user gives none (undefined, or an empty/
  // whitespace string from a bare `"$ARGUMENTS"` expansion — never `$0`, which
  // the shell expands to its own argv[0], e.g. /run/current-system/sw/bin/bash),
  // fall back to an innocuous
  // no-op instruction: the forked Claude acknowledges and waits, leaving the
  // window open and interactive at the branch point without doing any work.
  const prompt = args.prompt?.trim() ? args.prompt : NOOP_PROMPT;

  const claudeBin = resolveClaudeBin(env);
  const { backend, split } = select(env, args.backend, args.split);

  const ctx: SpawnCtx = {
    claudeBin,
    sessionId,
    prompt,
    forkName: args.name,
    split,
    // The fork must launch in the cwd whose project slug owns the session's
    // transcript so --resume can locate it. That is the session's START cwd,
    // which differs from process.cwd() if the session cd'd mid-run — so resolve
    // it from the transcript rather than assuming process.cwd().
    cwd: resolveForkCwd(sessionId, process.cwd()),
    env,
  };

  backend.spawn(ctx);

  const where =
    backend.capabilities.tier === "pane" && split
      ? `${backend.name} (${split === "h" ? "horizontal" : "vertical"} split)`
      : `${backend.name} (new window)`;
  process.stdout.write(
    `Forked session ${sessionId} → opening in ${where}.\n`,
  );
}

// Run main() only when invoked as a script (the skill's `npx tsx branch.ts`
// path), not when imported by a test — importing must not spawn a terminal.
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (err) {
    process.stderr.write(`branch-window: ${(err as Error).message}\n`);
    process.exit(1);
  }
}
