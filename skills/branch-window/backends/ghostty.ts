import { spawn } from "node:child_process";
import type { Backend, SpawnCtx } from "../lib/types.ts";
import { forkCommand } from "../lib/types.ts";
import { hasBin } from "../lib/util.ts";

// Ghostty has no CLI control IPC (no `ghostty split` / remote socket), so it
// can only open a fresh OS *window*, never a scriptable pane. Hence tier
// "window-only": core warns once if --split was requested, then proceeds here.
// A new *tab* in the running app is impossible for the same reason: passing args
// (the `-e` command below) disables GTK single-instance, and there's no tab IPC
// or --new-tab flag. See README.md "No new-tab support" (upstream #12136).
//
// Known GTK bug: when a Ghostty instance is already running, `ghostty -e <cmd>`
// can be routed to the existing instance over D-Bus and the command payload is
// dropped, opening an empty shell instead of our forked session. Forcing a
// fresh process with --gtk-single-instance=false sidesteps it. Default on;
// disable with BRANCH_WINDOW_GHOSTTY_FRESH=0 once you've confirmed plain `-e`
// spawns cleanly on this machine.
export const ghostty: Backend = {
  name: "ghostty",
  capabilities: {
    tier: "window-only",
    splits: [],
    autoDetect: () => false, // never auto-picked; reached as explicit default
  },

  isAvailable: (env) => hasBin("ghostty", env),

  spawn: (ctx: SpawnCtx) => {
    const fresh = ctx.env.BRANCH_WINDOW_GHOSTTY_FRESH !== "0";
    const args = [
      ...(fresh ? ["--gtk-single-instance=false"] : []),
      // The new window must open in the session's cwd so `claude --resume` can
      // find the transcript. Ghostty's default is `working-directory = inherit`,
      // but the detached spawn breaks inheritance, so set it explicitly.
      `--working-directory=${ctx.cwd}`,
      "-e",
      ...forkCommand(ctx),
    ];
    // detached + unref == setsid: the new window outlives this skill process.
    spawn("ghostty", args, {
      cwd: ctx.cwd,
      detached: true,
      stdio: "ignore",
    }).unref();
  },
};
