import { spawn } from "node:child_process";
import type { Backend, SpawnCtx } from "../lib/types.ts";
import { forkArgs } from "../lib/types.ts";
import { hasBin } from "../lib/util.ts";

// wezterm backend. Pane-capable via `wezterm cli`. When already inside wezterm
// ($WEZTERM_PANE set) it splits the active pane; otherwise it spawns a new
// window in the GUI. Provided as a working stub; auto-detected when running
// under wezterm.
export const wezterm: Backend = {
  name: "wezterm",
  capabilities: {
    tier: "pane",
    splits: ["h", "v"],
    autoDetect: (env) => !!env.WEZTERM_PANE,
  },

  isAvailable: (env) => hasBin("wezterm", env),

  spawn: (ctx: SpawnCtx) => {
    const inner = [ctx.claudeBin, ...forkArgs(ctx)];

    // --cwd sets the new pane/window's directory to the session's cwd so
    // `claude --resume` can locate the transcript.
    let args: string[];
    if (ctx.env.WEZTERM_PANE) {
      // --horizontal = side-by-side (our "h"); default = stacked (our "v").
      const orient = ctx.split === "h" ? ["--horizontal"] : [];
      args = ["cli", "split-pane", ...orient, "--cwd", ctx.cwd, "--", ...inner];
    } else {
      args = ["cli", "spawn", "--cwd", ctx.cwd, "--", ...inner];
    }

    spawn("wezterm", args, { cwd: ctx.cwd, detached: true, stdio: "ignore" }).unref();
  },
};
