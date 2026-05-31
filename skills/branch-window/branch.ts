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

import { existsSync } from "node:fs";
import { join } from "node:path";
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

function parseArgs(argv: string[]): Args {
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
function resolveClaudeBin(env: NodeJS.ProcessEnv): string {
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

function main(): void {
  const env = process.env;

  const sessionId = env.CLAUDE_CODE_SESSION_ID;
  if (!sessionId) {
    throw new Error("CLAUDE_CODE_SESSION_ID is not set — run this from inside Claude Code");
  }

  const args = parseArgs(process.argv.slice(2));

  // The CLI can't open a fork idle — a prompt is mandatory (it becomes the
  // fork's first turn). When the user gives none (undefined, or an empty/
  // whitespace string from a bare `"$0"` expansion), fall back to an innocuous
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
    // The fork must launch in the session's cwd so --resume can locate its
    // transcript (resolved from the cwd's project slug). The skill runs in the
    // parent session's cwd, so process.cwd() is correct.
    cwd: process.cwd(),
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

try {
  main();
} catch (err) {
  process.stderr.write(`branch-window: ${(err as Error).message}\n`);
  process.exit(1);
}
