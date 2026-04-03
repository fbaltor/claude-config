import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url)).replace("/__tests__", "");
const SCRIPT = join(SCRIPTS_DIR, "linear-doc-sync.ts");
const TSX_LOADER = join(SCRIPTS_DIR, "node_modules", "tsx", "dist", "loader.mjs");

/** Shell out to the CLI. Runs from the scripts dir so tsx is resolvable. */
function run(args: string): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execSync(`node --import ${TSX_LOADER} ${SCRIPT} ${args}`, {
      cwd: SCRIPTS_DIR,
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

function makeFrontmatter(docId: string, hash?: string): string {
  const lines = [`linear_document_id: ${docId}`];
  if (hash) lines.push(`linear_sync_hash: ${hash}`);
  return `---\n${lines.join("\n")}\n---\n\n`;
}

/** Same hash algorithm as lib/linear.ts computeSyncHash. */
function computeHash(body: string): string {
  const normalized = body.trim().replace(/\r\n/g, "\n");
  return createHash("sha256").update(normalized, "utf-8").digest("hex").slice(0, 12);
}

describe("linear-doc-sync check (single file)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "doc-sync-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reports IN SYNC when stored hash matches current content", () => {
    const body = "# My Document\n\nSome content here.\n";
    const hash = computeHash(body);
    const file = join(tmpDir, "synced.md");
    writeFileSync(file, makeFrontmatter("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", hash) + body);

    const result = run(`check ${file}`);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /IN SYNC/);
    assert.match(result.stdout, new RegExp(hash));
  });

  it("reports DRIFTED when content has changed since last sync", () => {
    const originalBody = "# Original\n\nOld content.\n";
    const hash = computeHash(originalBody);
    const newBody = "# Updated\n\nNew content.\n";
    const file = join(tmpDir, "drifted.md");
    writeFileSync(file, makeFrontmatter("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", hash) + newBody);

    const result = run(`check ${file}`);
    assert.equal(result.code, 1);
    assert.match(result.stdout, /DRIFTED/);
    assert.match(result.stdout, /stored:/);
    assert.match(result.stdout, /current:/);
  });

  it("reports NEVER SYNCED when linear_sync_hash is missing", () => {
    const body = "# New doc\n\nNever pushed.\n";
    const file = join(tmpDir, "never-synced.md");
    writeFileSync(file, makeFrontmatter("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee") + body);

    const result = run(`check ${file}`);
    assert.equal(result.code, 1);
    assert.match(result.stdout, /NEVER SYNCED/);
  });

  it("fails when file has no linear_document_id", () => {
    const file = join(tmpDir, "no-id.md");
    writeFileSync(file, "---\ntitle: Just a doc\n---\n\n# No Linear link\n");

    const result = run(`check ${file}`);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /linear_document_id/);
  });

  it("fails when file does not exist", () => {
    const result = run(`check ${join(tmpDir, "nonexistent.md")}`);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /not found/i);
  });
});

describe("linear-doc-sync check (all)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "doc-sync-all-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("finds linked docs and reports mixed status", () => {
    const body = "# Doc\n\nContent.\n";
    const hash = computeHash(body);
    mkdirSync(join(tmpDir, "docs"), { recursive: true });

    // Synced file
    writeFileSync(
      join(tmpDir, "docs", "synced.md"),
      makeFrontmatter("11111111-1111-1111-1111-111111111111", hash) + body,
    );

    // Drifted file
    writeFileSync(
      join(tmpDir, "docs", "drifted.md"),
      makeFrontmatter("22222222-2222-2222-2222-222222222222", hash) + "# Changed content\n",
    );

    // Run check from the tmpDir so findLinearLinkedDocs scans it
    // We need to override cwd for the script — use a wrapper
    const result = runFromDir(tmpDir, "check");
    assert.equal(result.code, 1);
    assert.match(result.stdout, /2 Linear-linked doc/);
    assert.match(result.stdout, /1 in sync, 1 drifted/);
  });

  it("exits 0 when all docs are in sync", () => {
    const body = "# Doc\n\nContent.\n";
    const hash = computeHash(body);
    mkdirSync(join(tmpDir, "docs"), { recursive: true });

    writeFileSync(
      join(tmpDir, "docs", "a.md"),
      makeFrontmatter("11111111-1111-1111-1111-111111111111", hash) + body,
    );
    writeFileSync(
      join(tmpDir, "docs", "b.md"),
      makeFrontmatter("22222222-2222-2222-2222-222222222222", hash) + body,
    );

    const result = runFromDir(tmpDir, "check");
    assert.equal(result.code, 0);
    assert.match(result.stdout, /2 in sync, 0 drifted/);
  });

  it("reports no docs found in empty directory", () => {
    const result = runFromDir(tmpDir, "check");
    assert.equal(result.code, 0);
    assert.match(result.stdout, /No Linear-linked docs found/);
  });
});

/**
 * Run the script with a custom working directory.
 * Uses `cd <dir> &&` to set cwd for the script while keeping tsx resolvable
 * via NODE_PATH.
 */
function runFromDir(dir: string, args: string): { code: number; stdout: string; stderr: string } {
  const nodeModules = join(SCRIPTS_DIR, "node_modules");
  try {
    const stdout = execSync(
      `node --import ${TSX_LOADER} ${SCRIPT} ${args}`,
      {
        cwd: dir,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          NODE_NO_WARNINGS: "1",
          NODE_PATH: nodeModules,
        },
      },
    );
    return { code: 0, stdout, stderr: "" };
  } catch (err: any) {
    return {
      code: err.status ?? 1,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
    };
  }
}
