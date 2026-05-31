import { spawn } from "node:child_process";
import type { Backend, SpawnCtx } from "../lib/types.ts";
import { forkArgs } from "../lib/types.ts";
import { hasBin } from "../lib/util.ts";

// tmux is the pane-capable backend: when we're already inside tmux ($TMUX set)
// it splits the current pane, otherwise it opens a new window in the running
// server. Either way the forked `claude` runs in a real, scriptable surface,
// so --split is honored here.
export const tmux: Backend = {
  name: "tmux",
  capabilities: {
    tier: "pane",
    splits: ["h", "v"],
    autoDetect: (env) => !!env.TMUX,
  },

  isAvailable: (env) => hasBin("tmux", env),

  spawn: (ctx: SpawnCtx) => {
    // The command tmux will run inside the new pane/window.
    const inner = [ctx.claudeBin, ...forkArgs(ctx)];

    // -c sets the new pane/window's start directory to the session's cwd so
    // `claude --resume` can locate the transcript.
    let tmuxArgs: string[];
    if (ctx.env.TMUX) {
      // Inside tmux: split the current pane. -h = side-by-side, -v = stacked.
      const dir = ctx.split === "v" ? "-v" : "-h";
      tmuxArgs = ["split-window", dir, "-c", ctx.cwd, ...inner];
    } else {
      // No surrounding tmux: open a new window in the (running) server.
      tmuxArgs = ["new-window", "-c", ctx.cwd, ...inner];
    }

    spawn("tmux", tmuxArgs, { cwd: ctx.cwd, detached: true, stdio: "ignore" }).unref();
  },
};
