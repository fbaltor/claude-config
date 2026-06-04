import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";

import { waitStable } from "../src/readiness";
import type { DisplaySession } from "../src/types";

// A session whose capture() writes a scripted sequence of frame buffers (the last one repeats).
function fakeSession(frames: Buffer[]): DisplaySession {
  let i = 0;
  return {
    name: "fake",
    env: {},
    outputName: "X",
    async capture(p: string) {
      const f = frames[Math.min(i, frames.length - 1)];
      i++;
      await fs.writeFile(p, f);
    },
    async key() {},
    async type() {},
    async resize() {},
    async stop() {},
  };
}

const big = (fill: number) => Buffer.alloc(20000, fill); // > minBytes, distinct per fill
const blank = Buffer.alloc(100, 0); // < minBytes

const fast = { intervalMs: 5, minBytes: 8000 } as const;

test("waitStable: returns true once frames stop changing", async () => {
  const s = fakeSession([big(1), big(2), big(2), big(2)]);
  const ok = await waitStable(s, { ...fast, timeoutMs: 1000, stableFrames: 2 });
  assert.equal(ok, true);
});

test("waitStable: identical frames from the start satisfy stableFrames", async () => {
  const s = fakeSession([big(7)]); // always the same
  const ok = await waitStable(s, { ...fast, timeoutMs: 1000, stableFrames: 3 });
  assert.equal(ok, true);
});

test("waitStable: blank (sub-minBytes) frames never count -> times out false", async () => {
  const s = fakeSession([blank]); // always blank
  const ok = await waitStable(s, { ...fast, timeoutMs: 120, stableFrames: 2 });
  assert.equal(ok, false);
});

test("waitStable: blank loading frames then steady content -> settles true", async () => {
  // realistic startup: the output is blank while the app loads, then content appears and holds.
  const s = fakeSession([blank, blank, big(5)]); // last frame (big(5)) repeats
  const ok = await waitStable(s, { ...fast, timeoutMs: 1000, stableFrames: 2 });
  assert.equal(ok, true);
});

test("waitStable: content that then goes blank never settles -> false", async () => {
  // app drew once then its surface went blank/crashed; must not be reported ready.
  const s = fakeSession([big(1), blank]); // last frame (blank) repeats forever
  const ok = await waitStable(s, { ...fast, timeoutMs: 120, stableFrames: 2 });
  assert.equal(ok, false);
});

test("waitStable: tolerates capture() throwing, then settles", async () => {
  let i = 0;
  const session: DisplaySession = {
    name: "fake",
    env: {},
    outputName: "X",
    async capture(p: string) {
      i++;
      if (i <= 2) throw new Error("not ready");
      await fs.writeFile(p, big(9));
    },
    async key() {},
    async type() {},
    async resize() {},
    async stop() {},
  };
  const ok = await waitStable(session, { ...fast, timeoutMs: 1000, stableFrames: 2 });
  assert.equal(ok, true);
});
