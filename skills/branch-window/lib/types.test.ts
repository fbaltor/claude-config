// SUITE 3 — forkArgs: builds the inner `claude` argv shared by every backend.
// SUITE 3b — forkCommand: the full exec'd command (env wrapper + forkArgs).

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { FORCE_PERSIST, forkArgs, forkCommand } from "./types.ts";
import type { SpawnCtx } from "./types.ts";

/** Minimal SpawnCtx; individual tests override fields they care about. */
function ctx(overrides: Partial<SpawnCtx> = {}): SpawnCtx {
  return {
    claudeBin: "/usr/bin/claude",
    sessionId: "sid-123",
    prompt: "do the thing",
    cwd: "/home/fbaltor",
    env: {},
    ...overrides,
  };
}

describe("forkArgs", () => {
  it("minimal ctx -> [--resume, id, --fork-session, prompt]", () => {
    const got = forkArgs(ctx({ sessionId: "sid-123", prompt: "do the thing" }));
    assert.deepEqual(got, [
      "--resume",
      "sid-123",
      "--fork-session",
      "do the thing",
    ]);
  });

  it("forkName set -> inserts [-n, 'branch: <name>'] before the prompt", () => {
    const got = forkArgs(
      ctx({ sessionId: "sid-123", prompt: "do the thing", forkName: "alpha" }),
    );
    assert.deepEqual(got, [
      "--resume",
      "sid-123",
      "--fork-session",
      "-n",
      "branch: alpha",
      "do the thing",
    ]);
  });

  it("prompt is always the LAST element (no forkName)", () => {
    const got = forkArgs(ctx({ prompt: "last-one" }));
    assert.equal(got[got.length - 1], "last-one");
  });

  it("prompt is always the LAST element (with forkName)", () => {
    const got = forkArgs(ctx({ prompt: "still-last", forkName: "beta" }));
    assert.equal(got[got.length - 1], "still-last");
  });
});

describe("forkCommand", () => {
  it("wraps forkArgs in `env CLAUDE_CODE_FORCE_SESSION_PERSISTENCE=1 <claudeBin> …`", () => {
    const c = ctx({ sessionId: "sid-123", prompt: "do the thing" });
    assert.deepEqual(forkCommand(c), [
      "env",
      "CLAUDE_CODE_FORCE_SESSION_PERSISTENCE=1",
      "/usr/bin/claude",
      ...forkArgs(c),
    ]);
  });

  it("FORCE_PERSIST is a KEY=VALUE token consumable by `env`", () => {
    assert.match(FORCE_PERSIST, /^[A-Z_]+=1$/);
  });

  it("prompt is still the LAST element", () => {
    const got = forkCommand(ctx({ prompt: "still-last", forkName: "beta" }));
    assert.equal(got[got.length - 1], "still-last");
  });
});
