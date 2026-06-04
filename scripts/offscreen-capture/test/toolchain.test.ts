import test from "node:test";
import assert from "node:assert/strict";

import { resolveToolchain } from "../src/toolchain";
import type { RunFn, RunResult } from "../src/proc";

// Build a fake runner. `handler` returns a partial result keyed off the command.
function fakeRun(handler: (cmd: string, args: string[]) => Partial<RunResult>): RunFn {
  return async (cmd, args) => ({ code: 0, stdout: "", stderr: "", ...handler(cmd, args) });
}

test("resolveToolchain: all bins present -> no nix-shell, PATH unchanged", async () => {
  let nixCalls = 0;
  const run = fakeRun((cmd) => {
    if (cmd === "nix-shell") {
      nixCalls++;
      return { stdout: "/should/not/be/used" };
    }
    return { code: 0 }; // `command -v` succeeds for every bin
  });

  const env = await resolveToolchain(["sway"], ["sway", "grim"], run);
  assert.equal(nixCalls, 0);
  assert.equal(env.PATH, process.env.PATH);
});

test("resolveToolchain: missing bin -> one nix-shell call, PATH prepended, host PATH preserved", async () => {
  let nixCalls = 0;
  const run = fakeRun((cmd) => {
    if (cmd === "nix-shell") {
      nixCalls++;
      return { code: 0, stdout: "/nix/store/abc/bin\n" };
    }
    return { code: 1 }; // every `command -v` fails -> bins missing
  });

  const env = await resolveToolchain(["sway", "grim"], ["sway", "grim"], run);
  assert.equal(nixCalls, 1);
  assert.ok(env.PATH?.startsWith("/nix/store/abc/bin:"), `PATH was ${env.PATH}`);
  assert.ok(env.PATH?.includes(process.env.PATH ?? "<none>"));
});

test("resolveToolchain: missing bin with no nixPkgs -> throws", async () => {
  const run = fakeRun(() => ({ code: 1 }));
  await assert.rejects(() => resolveToolchain([], ["sway"], run), /missing executables/);
});

test("resolveToolchain: nix-shell failure surfaces as an error", async () => {
  const run = fakeRun((cmd) =>
    cmd === "nix-shell" ? { code: 1, stderr: "boom" } : { code: 1 },
  );
  await assert.rejects(() => resolveToolchain(["sway"], ["sway"], run), /nix-shell provisioning failed/);
});
