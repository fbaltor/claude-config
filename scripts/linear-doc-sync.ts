#!/usr/bin/env npx tsx
/**
 * Linear document push for Claude Code skills.
 *
 * Usage:
 *   linear-doc-sync.ts push [file_path]   Push file (or all linked docs) to Linear
 *
 * Files use YAML frontmatter to store the Linear document ID:
 *   ---
 *   linear_document_id: <uuid>
 *   ---
 *
 * Env vars (from ~/.config/env/linear):
 *   LINEAR_API_KEY_ALL   — read+write (used for push)
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  getClient,
  findLinearLinkedDocs,
  parseFrontmatter,
  buildFrontmatter,
  buildSyncBanner,
  computeSyncHash,
} from "./lib/linear.ts";

type PushResult = "pushed" | "skipped" | "failed";

async function push(filePath: string, force = false): Promise<PushResult> {
  const absPath = resolve(filePath);
  if (!existsSync(absPath)) {
    console.error(`  File not found: ${absPath}`);
    return "failed";
  }

  const raw = readFileSync(absPath, "utf-8");
  const { data, body } = parseFrontmatter(raw);

  const docId = data.linear_document_id;
  if (!docId) {
    console.error(`  No \`linear_document_id\` in frontmatter.`);
    return "failed";
  }

  const hash = computeSyncHash(body);
  if (!force && data.linear_sync_hash === hash) {
    return "skipped";
  }

  const client = getClient("write");
  const content = buildSyncBanner(filePath) + body.trimEnd() + "\n";

  const result = await client.updateDocument(docId, { content });
  if (result.success) {
    data.linear_sync_hash = hash;
    const updated = buildFrontmatter(data, body);
    writeFileSync(absPath, updated, "utf-8");

    console.log(`  ${filePath} (${body.trim().length} chars, hash: ${hash})`);
    return "pushed";
  } else {
    console.error(`  Failed to update Linear document for ${filePath}.`);
    return "failed";
  }
}

async function pushAll(cwd: string): Promise<void> {
  const docs = findLinearLinkedDocs(cwd);
  if (docs.length === 0) {
    console.log("No Linear-linked docs found.");
    return;
  }

  console.log(`Found ${docs.length} Linear-linked doc(s).\n`);
  const pushed: string[] = [];
  const skipped: string[] = [];
  const failed: string[] = [];
  for (const doc of docs) {
    const result = await push(doc.filePath);
    ({ pushed, skipped, failed })[result].push(doc.filePath);
  }

  console.log(`\n--- Summary ---`);
  if (pushed.length > 0) {
    console.log(`Pushed (${pushed.length}):`);
    for (const f of pushed) console.log(`  ✓ ${f}`);
  }
  if (skipped.length > 0) {
    console.log(`Skipped (${skipped.length}, unchanged):`);
    for (const f of skipped) console.log(`  - ${f}`);
  }
  if (failed.length > 0) {
    console.log(`Failed (${failed.length}):`);
    for (const f of failed) console.log(`  ✗ ${f}`);
  }
  if (failed.length > 0) process.exit(1);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === "push") {
    const filePath = args[1];
    if (!filePath) {
      await pushAll(process.cwd());
      return;
    }
    const result = await push(filePath);
    if (result === "skipped") console.log(`Skipped (unchanged): ${filePath}`);
    if (result === "failed") process.exit(1);
  } else {
    console.error("Usage: linear-doc-sync.ts push [file_path]");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
