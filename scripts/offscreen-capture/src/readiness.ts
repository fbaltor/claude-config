// Backend-agnostic readiness: capture frames on a poll and consider the app "settled" once
// consecutive frames are byte-identical. Blank frames (app not drawn yet) are rejected by a
// minimum-size gate — a single-colour PNG is tiny, a real UI frame is large — so we never
// mistake an empty headless output for a stable result.

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { DisplaySession } from "./types";
import { sleep } from "./proc";

async function hashFile(p: string): Promise<string> {
  const buf = await fs.readFile(p);
  return createHash("sha256").update(buf).digest("hex");
}

export interface StableOpts {
  timeoutMs?: number;
  intervalMs?: number;
  stableFrames?: number; // consecutive identical frames required
  minBytes?: number; // frames smaller than this are treated as "blank / not ready"
}

// Returns true once the frame is stable, false if the timeout is hit first.
export async function waitStable(session: DisplaySession, opts: StableOpts = {}): Promise<boolean> {
  const timeoutMs = opts.timeoutMs ?? 30000;
  const intervalMs = opts.intervalMs ?? 800;
  const need = opts.stableFrames ?? 2;
  const minBytes = opts.minBytes ?? 8000;

  const tmp = path.join(os.tmpdir(), `osc-stable-${process.pid}-${Date.now()}.png`);
  const t0 = Date.now();
  let last = "";
  let stable = 0;
  try {
    while (Date.now() - t0 < timeoutMs) {
      await sleep(intervalMs);
      try {
        await session.capture(tmp);
      } catch {
        continue;
      }
      let size = 0;
      try {
        size = (await fs.stat(tmp)).size;
      } catch {
        continue;
      }
      if (size < minBytes) {
        // blank / loading frame — reset
        stable = 0;
        last = "";
        continue;
      }
      const h = await hashFile(tmp);
      if (h === last) {
        if (++stable >= need) return true;
      } else {
        stable = 1; // count the current frame as the first stable observation
        last = h;
      }
    }
    return false;
  } finally {
    await fs.rm(tmp, { force: true }).catch(() => {});
  }
}
