import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url)).replace("/__tests__", "");
const SCRIPT = join(SCRIPTS_DIR, "linear-fetch.ts");
const TSX_LOADER = join(SCRIPTS_DIR, "node_modules", "tsx", "dist", "loader.mjs");

function run(
  args: string,
  opts: { cwd?: string } = {},
): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execSync(`node --import ${TSX_LOADER} ${SCRIPT} ${args}`, {
      cwd: opts.cwd ?? SCRIPTS_DIR,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
    });
    return { code: 0, stdout, stderr: "" };
  } catch (err: any) {
    return {
      code: err.status ?? 1,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
    };
  }
}

describe("linear-fetch usage help", () => {
  let tmpDir: string;

  beforeEach(() => {
    // Run against a controlled repo on a NON-Linear branch so the outcome
    // doesn't depend on whatever branch the test runner happens to be on.
    tmpDir = mkdtempSync(join(tmpdir(), "linear-fetch-help-"));
    const gitEnv = "-c user.email=t@t -c user.name=t";
    execSync(`git init -q`, { cwd: tmpDir });
    execSync(`git ${gitEnv} commit -q --allow-empty -m init`, { cwd: tmpDir });
    execSync(`git checkout -q -b chore/no-linear-id`, { cwd: tmpDir });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("with no arguments, tells the user which commands are available", () => {
    // Slash-command invocation passes "$ARGUMENTS" — empty string when the
    // user types just `/linear`. Match that shape here.
    const { code, stdout } = run('""', { cwd: tmpDir });

    assert.equal(code, 0);
    assert.match(stdout, /--fetch-issue/);
    assert.match(stdout, /--fetch-project/);
    assert.match(stdout, /linear-push-doc/);
    // Branch has no Linear ID, so help explains why rather than fetching.
    assert.match(stdout, /doesn't contain a Linear issue ID/);
    // Help mode must NOT emit the free-form `**Current branch:**` context line.
    assert.doesNotMatch(stdout, /\*\*Current branch:\*\*/);
  });

  it("with a whitespace-only argument, still shows the usage help", () => {
    const { code, stdout } = run('"   "', { cwd: tmpDir });

    assert.equal(code, 0);
    assert.match(stdout, /--fetch-issue/);
    assert.match(stdout, /--fetch-project/);
    assert.doesNotMatch(stdout, /\*\*Current branch:\*\*/);
  });
});

describe("linear-fetch free-form context", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "linear-fetch-test-"));
    const gitEnv = "-c user.email=t@t -c user.name=t";
    execSync(`git init -q`, { cwd: tmpDir });
    execSync(`git ${gitEnv} commit -q --allow-empty -m init`, { cwd: tmpDir });
    execSync(`git checkout -q -b baltor/jump-304-example`, { cwd: tmpDir });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("on a Linear-shaped branch, surfaces the branch name and its parsed issue identifier", () => {
    const { code, stdout } = run('"show me the issue"', { cwd: tmpDir });

    assert.equal(code, 0);
    assert.match(stdout, /baltor\/jump-304-example/);
    assert.match(stdout, /JUMP-304/);
    // Free-form path should not print the usage help.
    assert.doesNotMatch(stdout, /linear-push-doc/);
  });
});
