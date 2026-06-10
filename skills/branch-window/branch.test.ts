// Tests for branch.ts exports: resolveForkCwd (Suite 1), parseArgs (Suite 2),
// resolveClaudeBin (Suite 5).
//
// TEST AUTHOR NOTE: resolveForkCwd is a known STUB that returns its `fallback`
// arg unconditionally. Suite-1 cases 1.1/1.2/1.3/1.6 assert the real contract
// (return the start cwd from the transcript) and are EXPECTED TO FAIL against
// the stub. Cases that legitimately return the fallback (1.4/1.5/1.7/1.8) pass
// against both stub and real impl. Do NOT touch the stub to make them green.
//
// All fixtures are hermetic: mkdtemp temp dirs, cleaned up in after-hooks.
// resolveForkCwd is always called with an explicit temp `projectsRoot` so the
// real ~/.claude/projects is never read.

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseArgs, resolveClaudeBin, resolveForkCwd } from "./branch.ts";

// ---------------------------------------------------------------------------
// SUITE 1 — resolveForkCwd
// ---------------------------------------------------------------------------

describe("resolveForkCwd", () => {
  let root: string;
  const tmpDirs: string[] = [];

  function newRoot(): string {
    const d = mkdtempSync(join(tmpdir(), "branch-window-projects-"));
    tmpDirs.push(d);
    return d;
  }

  /** Write a `<id>.jsonl` transcript under a `<slug>` subdir of `projectsRoot`. */
  function writeTranscript(
    projectsRoot: string,
    slug: string,
    id: string,
    lines: string[],
  ): void {
    const slugDir = join(projectsRoot, slug);
    mkdirSync(slugDir, { recursive: true });
    writeFileSync(join(slugDir, `${id}.jsonl`), lines.join("\n") + "\n");
  }

  before(() => {
    root = newRoot();
  });

  after(() => {
    for (const d of tmpDirs) {
      rmSync(d, { recursive: true, force: true });
    }
  });

  // 1.1 — first cwd-record's cwd is returned (not the fallback).
  // EXPECTED TO FAIL against the stub.
  it("1.1 returns the start cwd from the first cwd-bearing record", () => {
    const r = newRoot();
    const id = "sess-1-1";
    writeTranscript(r, "home-fbaltor", id, [
      JSON.stringify({ type: "user", cwd: "/home/fbaltor", sessionId: id }),
    ]);
    const got = resolveForkCwd(id, "/home/fbaltor/memory", r);
    assert.equal(got, "/home/fbaltor");
  });

  // 1.2 — head records without cwd are skipped; first cwd-bearing one wins.
  // EXPECTED TO FAIL against the stub.
  it("1.2 skips leading non-cwd head records and returns the first cwd-bearing record", () => {
    const r = newRoot();
    const id = "sess-1-2";
    writeTranscript(r, "home-fbaltor", id, [
      JSON.stringify({ type: "last-prompt" }),
      JSON.stringify({ type: "mode" }),
      JSON.stringify({ type: "permission-mode" }),
      JSON.stringify({ type: "user", cwd: "/home/fbaltor", sessionId: id }),
    ]);
    const got = resolveForkCwd(id, "/home/fbaltor/memory", r);
    assert.equal(got, "/home/fbaltor");
  });

  // 1.3 — returns the FIRST cwd record, not a later one.
  // EXPECTED TO FAIL against the stub.
  it("1.3 returns the FIRST cwd record when the session cd'd mid-run", () => {
    const r = newRoot();
    const id = "sess-1-3";
    writeTranscript(r, "home-fbaltor", id, [
      JSON.stringify({ type: "user", cwd: "/home/fbaltor", sessionId: id }),
      JSON.stringify({ type: "assistant", sessionId: id }),
      JSON.stringify({ type: "user", cwd: "/home/fbaltor/memory", sessionId: id }),
    ]);
    const got = resolveForkCwd(id, "/some/other/fallback", r);
    assert.equal(got, "/home/fbaltor");
  });

  // 1.4 — no <id>.jsonl anywhere under root -> fallback. Passes vs stub + real.
  it("1.4 returns fallback when no transcript file exists for the id", () => {
    const r = newRoot();
    // Unrelated file present, but not <id>.jsonl.
    writeTranscript(r, "home-fbaltor", "some-other-session", [
      JSON.stringify({ type: "user", cwd: "/home/fbaltor", sessionId: "x" }),
    ]);
    const got = resolveForkCwd("sess-1-4", "/home/fbaltor/memory", r);
    assert.equal(got, "/home/fbaltor/memory");
  });

  // 1.5 — file exists but has ZERO cwd records -> fallback. Passes vs both.
  it("1.5 returns fallback when the transcript has no cwd-bearing record", () => {
    const r = newRoot();
    const id = "sess-1-5";
    writeTranscript(r, "home-fbaltor", id, [
      JSON.stringify({ type: "last-prompt" }),
      JSON.stringify({ type: "mode" }),
      JSON.stringify({ type: "permission-mode" }),
    ]);
    const got = resolveForkCwd(id, "/home/fbaltor/memory", r);
    assert.equal(got, "/home/fbaltor/memory");
  });

  // 1.6 — a malformed/partial-JSON line before a valid cwd record is skipped,
  // no throw, valid cwd returned. EXPECTED TO FAIL against the stub.
  it("1.6 skips malformed JSON lines and returns the next valid cwd, no throw", () => {
    const r = newRoot();
    const id = "sess-1-6";
    writeTranscript(r, "home-fbaltor", id, [
      "{not valid json at all",
      '{"type":"user","cwd":"/home/fbaltor"', // truncated / partial JSON
      JSON.stringify({ type: "user", cwd: "/home/fbaltor", sessionId: id }),
    ]);
    let got: string | undefined;
    assert.doesNotThrow(() => {
      got = resolveForkCwd(id, "/home/fbaltor/memory", r);
    });
    assert.equal(got, "/home/fbaltor");
  });

  // 1.7 — only another session's <other-id>.jsonl present -> fallback, never
  // the other session's cwd. Passes vs both stub and real.
  it("1.7 returns fallback when only a different session's transcript exists", () => {
    const r = newRoot();
    writeTranscript(r, "home-fbaltor", "other-id", [
      JSON.stringify({ type: "user", cwd: "/home/fbaltor", sessionId: "other-id" }),
    ]);
    const got = resolveForkCwd("sess-1-7", "/home/fbaltor/memory", r);
    assert.equal(got, "/home/fbaltor/memory");
    assert.notEqual(got, "/home/fbaltor");
  });

  // 1.8 — projectsRoot path does not exist -> fallback, no throw. Passes vs both.
  it("1.8 returns fallback (no throw) when projectsRoot does not exist", () => {
    const missing = join(root, "does", "not", "exist", "anywhere");
    let got: string | undefined;
    assert.doesNotThrow(() => {
      got = resolveForkCwd("sess-1-8", "/home/fbaltor/memory", missing);
    });
    assert.equal(got, "/home/fbaltor/memory");
  });
});

// ---------------------------------------------------------------------------
// SUITE 2 — parseArgs
// ---------------------------------------------------------------------------

describe("parseArgs", () => {
  it('["hi"] -> { prompt: "hi" }', () => {
    assert.deepEqual(parseArgs(["hi"]), { prompt: "hi" });
  });

  it("[] -> {} (no prompt)", () => {
    const got = parseArgs([]);
    assert.deepEqual(got, {});
    assert.equal(got.prompt, undefined);
  });

  it('["--name","x"] -> { name: "x" }', () => {
    assert.deepEqual(parseArgs(["--name", "x"]), { name: "x" });
  });

  it('["--backend","tmux"] -> { backend: "tmux" }', () => {
    assert.deepEqual(parseArgs(["--backend", "tmux"]), { backend: "tmux" });
  });

  it('["--split","h"] -> { split: "h" }', () => {
    assert.deepEqual(parseArgs(["--split", "h"]), { split: "h" });
  });

  it('["--split","v"] -> { split: "v" }', () => {
    assert.deepEqual(parseArgs(["--split", "v"]), { split: "v" });
  });

  it('["--split","x"] throws', () => {
    assert.throws(() => parseArgs(["--split", "x"]), /--split must be h or v/);
  });

  it('["--bogus"] throws (unknown flag)', () => {
    assert.throws(() => parseArgs(["--bogus"]), /unknown flag/);
  });

  it('["a","b"] throws (second positional)', () => {
    assert.throws(() => parseArgs(["a", "b"]), /unexpected argument/);
  });

  it('["p","--name","n","--split","h"] parses all fields', () => {
    assert.deepEqual(parseArgs(["p", "--name", "n", "--split", "h"]), {
      prompt: "p",
      name: "n",
      split: "h",
    });
  });
});

// ---------------------------------------------------------------------------
// SUITE 5 — resolveClaudeBin (hermetic)
// ---------------------------------------------------------------------------

describe("resolveClaudeBin", () => {
  const tmpDirs: string[] = [];

  function newDir(prefix: string): string {
    const d = mkdtempSync(join(tmpdir(), prefix));
    tmpDirs.push(d);
    return d;
  }

  function makeFakeClaude(dir: string): string {
    const p = join(dir, "claude");
    writeFileSync(p, "#!/usr/bin/env bash\n");
    chmodSync(p, 0o755);
    return p;
  }

  after(() => {
    for (const d of tmpDirs) {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("returns CLAUDE_CODE_EXECPATH when it points to an existing file", () => {
    const dir = newDir("branch-window-execpath-");
    const fake = makeFakeClaude(dir);
    const got = resolveClaudeBin({ CLAUDE_CODE_EXECPATH: fake, PATH: "" });
    assert.equal(got, fake);
  });

  it("falls back to a PATH dir containing `claude` when EXECPATH is unset", () => {
    const dir = newDir("branch-window-path-");
    const fake = makeFakeClaude(dir);
    // EXECPATH unset; PATH includes our temp dir (plus a decoy that has no claude).
    const decoy = newDir("branch-window-decoy-");
    const got = resolveClaudeBin({ PATH: `${decoy}:${dir}` });
    assert.equal(got, fake);
  });

  it("throws when neither EXECPATH nor a PATH `claude` is present", () => {
    const empty = newDir("branch-window-empty-");
    assert.throws(
      () => resolveClaudeBin({ PATH: empty }),
      /could not locate the `claude` binary/,
    );
  });
});
