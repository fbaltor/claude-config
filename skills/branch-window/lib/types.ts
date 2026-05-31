// Shared contract for branch-window backends.
//
// A "backend" knows how to open a forked Claude Code session in a new
// terminal surface (a fresh OS window, or a split pane). Core (branch.ts)
// stays terminal-agnostic: it computes the fork command and hands a SpawnCtx
// to whichever backend was selected.

export type Tier = "window-only" | "pane";

export type Split = "h" | "v";

export interface Capabilities {
  /** "pane" backends can split the current surface; "window-only" cannot. */
  tier: Tier;
  /** Splits this backend honors. Empty for window-only backends. */
  splits: Split[];
  /**
   * Return true when the current environment indicates this backend should be
   * auto-selected (e.g. tmux when $TMUX is set). Window-only fallbacks return
   * false here and are reached only as the explicit default.
   */
  autoDetect: (env: NodeJS.ProcessEnv) => boolean;
}

export interface SpawnCtx {
  /** Absolute path (or PATH-resolvable name) of the `claude` binary. */
  claudeBin: string;
  /** Session ID to fork from. */
  sessionId: string;
  /**
   * First message sent to the forked session. Required: the CLI cannot resume
   * a fork idle — it must be given a prompt, which becomes the fork's opening
   * turn. After that turn the forked window stays interactive for continued
   * chat. (See SKILL.md "Why a prompt is required".)
   */
  prompt: string;
  /** Optional human label shown in the forked session's prompt box. */
  forkName?: string;
  /** Requested split; ignored (with a warning) by window-only backends. */
  split?: Split;
  /**
   * Working directory the forked `claude` must launch in. `claude --resume`
   * resolves a session's transcript from the cwd's project slug, so the fork
   * has to run in the original session's cwd or it errors with
   * "No conversation found". Set to the parent session's cwd.
   */
  cwd: string;
  /** Process env, passed through so backends can read their own knobs. */
  env: NodeJS.ProcessEnv;
}

export interface Backend {
  /** Stable identifier used by --backend and the registry. */
  name: string;
  capabilities: Capabilities;
  /** Whether the backend's terminal binary is actually usable right now. */
  isAvailable: (env: NodeJS.ProcessEnv) => boolean;
  /** Spawn the forked session, detached. Must not block the parent. */
  spawn: (ctx: SpawnCtx) => void;
}

/**
 * Build the inner `claude` argv shared by every backend. The prompt is the
 * trailing positional arg; without it the fork cannot launch (the CLI rejects
 * a promptless resume).
 */
export function forkArgs(ctx: SpawnCtx): string[] {
  const args = [
    "--resume",
    ctx.sessionId,
    "--fork-session",
  ];
  if (ctx.forkName) {
    args.push("-n", `branch: ${ctx.forkName}`);
  }
  args.push(ctx.prompt);
  return args;
}
