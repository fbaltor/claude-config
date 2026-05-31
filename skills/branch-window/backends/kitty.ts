import { spawn } from "node:child_process";
import type { Backend, SpawnCtx } from "../lib/types.ts";
import { forkArgs } from "../lib/types.ts";
import { hasBin } from "../lib/util.ts";

// kitty backend. Pane-capable via `kitty @ launch` over its remote-control
// socket — requires `allow_remote_control yes` in kitty.conf (and usually a
// listen socket). Provided as a working stub; not auto-detected by default.
//
// --split h -> new column (vsplit), --split v -> new row (hsplit). kitty's
// split location is governed by the active layout; `--location` gives a hint.
export const kitty: Backend = {
  name: "kitty",
  capabilities: {
    tier: "pane",
    splits: ["h", "v"],
    // Only auto-pick when remote control is plausibly wired up.
    autoDetect: (env) => !!env.KITTY_LISTEN_ON,
  },

  isAvailable: (env) => hasBin("kitty", env),

  spawn: (ctx: SpawnCtx) => {
    const inner = [ctx.claudeBin, ...forkArgs(ctx)];
    const location = ctx.split === "v" ? "hsplit" : "vsplit";
    const args = [
      "@",
      "launch",
      "--type=window",
      `--location=${location}`,
      // Session cwd so `claude --resume` can locate the transcript.
      `--cwd=${ctx.cwd}`,
      ...inner,
    ];
    spawn("kitty", args, { cwd: ctx.cwd, detached: true, stdio: "ignore" }).unref();
  },
};
