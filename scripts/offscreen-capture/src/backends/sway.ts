// Headless-sway backend.
//
// sway is a full wlroots compositor that exports the protocols we need: wlr-screencopy (-> grim),
// virtual-keyboard (-> wtype), and wlr-output-management (-> wlr-randr). cage was evaluated first
// and rejected: it is a bare kiosk that exports NONE of these, so grim/wtype/wlr-randr all fail.
//
// Lifecycle: write a tiny config (sized HEADLESS-1 output, fullscreen any window, and an `exec`
// that dumps $WAYLAND_DISPLAY to a file for deterministic socket discovery) -> launch sway on the
// headless backend with the host display stripped -> read the dumped WAYLAND_DISPLAY -> spawn the
// app against it. Capture/input/resize are auxiliary wayland clients on the same socket. Teardown
// kills the sway process group, which takes the app with it.

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ChildProcess } from "node:child_process";

import type { Backend, DisplaySession, Size, StartOpts } from "../types";
import { killGroup, runOk, sleep, spawnBg, waitFor, which } from "../proc";
import { chordToWtype } from "../util";

const OUTPUT = "HEADLESS-1";

export const swayBackend: Backend = {
  name: "sway",
  nixPkgs: ["sway", "grim", "wtype", "wlr-randr"],
  bins: ["sway", "grim", "wtype", "wlr-randr"],

  async start(opts: StartOpts): Promise<DisplaySession> {
    const { launch, size, baseEnv } = opts;
    const runtimeDir = baseEnv.XDG_RUNTIME_DIR ?? `/run/user/${process.getuid?.() ?? 1000}`;
    const work = await fs.mkdtemp(path.join(os.tmpdir(), "osc-sway-"));
    const cfgPath = path.join(work, "sway.conf");
    const wdFile = path.join(work, "wd");
    const swayLog = path.join(work, "sway.log");
    const appLog = path.join(work, "app.log");

    const cfg =
      [
        `output ${OUTPUT} resolution ${size.width}x${size.height} position 0 0`,
        `default_border none`,
        `default_floating_border none`,
        `for_window [app_id=".*"] fullscreen enable`,
        `for_window [class=".*"] fullscreen enable`,
        // deterministic socket discovery: sway exports WAYLAND_DISPLAY to its exec children
        `exec sh -c 'echo "$WAYLAND_DISPLAY" > ${wdFile}'`,
      ].join("\n") + "\n";
    await fs.writeFile(cfgPath, cfg);

    // Bring up the compositor on the headless backend; strip the host display so it runs pure-headless.
    const swayEnv: NodeJS.ProcessEnv = { ...baseEnv, XDG_RUNTIME_DIR: runtimeDir, WLR_BACKENDS: "headless" };
    delete swayEnv.WAYLAND_DISPLAY;
    delete swayEnv.DISPLAY;
    const swayBin = await which("sway", swayEnv);
    const sway: ChildProcess = spawnBg(swayBin, ["-c", cfgPath], { env: swayEnv, logPath: swayLog });

    const came = await waitFor(
      async () => {
        try {
          return (await fs.readFile(wdFile, "utf8")).trim().length > 0;
        } catch {
          return false;
        }
      },
      { timeoutMs: 15000, intervalMs: 200 },
    );
    if (!came) {
      killGroup(sway);
      const log = await fs.readFile(swayLog, "utf8").catch(() => "");
      await fs.rm(work, { recursive: true, force: true }).catch(() => {});
      throw new Error(`sway did not come up within 15s.\n--- sway.log tail ---\n${log.slice(-1500)}`);
    }
    const waylandDisplay = (await fs.readFile(wdFile, "utf8")).trim();

    // Env for every auxiliary client + the app itself.
    const clientEnv: NodeJS.ProcessEnv = {
      ...baseEnv,
      XDG_RUNTIME_DIR: runtimeDir,
      WAYLAND_DISPLAY: waylandDisplay,
    };

    const grimBin = await which("grim", clientEnv);
    const wtypeBin = await which("wtype", clientEnv);
    const wlrRandrBin = await which("wlr-randr", clientEnv);

    // Launch the target app inside the compositor.
    const appEnv: NodeJS.ProcessEnv = { ...clientEnv, ...(launch.env ?? {}) };
    const appBin = await which(launch.app, appEnv);
    const app: ChildProcess = spawnBg(appBin, launch.args ?? [], { env: appEnv, logPath: appLog });

    return {
      name: "sway",
      env: clientEnv,
      outputName: OUTPUT,
      async capture(outPath: string) {
        await runOk(grimBin, ["-o", OUTPUT, outPath], { env: clientEnv });
      },
      async key(chord: string) {
        await runOk(wtypeBin, chordToWtype(chord), { env: clientEnv });
      },
      async type(text: string) {
        await runOk(wtypeBin, [text], { env: clientEnv });
      },
      async resize(s: Size) {
        await runOk(wlrRandrBin, ["--output", OUTPUT, "--custom-mode", `${s.width}x${s.height}`], {
          env: clientEnv,
        });
      },
      async stop() {
        killGroup(app);
        killGroup(sway);
        await sleep(200);
        await fs.rm(work, { recursive: true, force: true }).catch(() => {});
      },
    };
  },
};
