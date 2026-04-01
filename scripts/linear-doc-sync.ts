#!/usr/bin/env npx tsx
/**
 * Linear document sync for Claude Code skills.
 *
 * Usage:
 *   linear-doc-sync.ts push <file_path>                Push file to linked Linear document
 *   linear-doc-sync.ts pull <file_path>                Pull from Linear (reads doc ID from frontmatter)
 *   linear-doc-sync.ts pull <file_path> --id <doc_id>  Pull with explicit doc ID (initial setup)
 *
 * Files use YAML frontmatter to store the Linear document ID:
 *   ---
 *   linear_document_id: <uuid>
 *   ---
 *
 * Env vars (from ~/.config/env/linear):
 *   LINEAR_API_KEY_READ  — read-only (used for pull)
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
  stripSyncBanner,
  computeSyncHash,
} from "./lib/linear.ts";

async function push(filePath: string): Promise<boolean> {
  const absPath = resolve(filePath);
  if (!existsSync(absPath)) {
    console.error(`  File not found: ${absPath}`);
    return false;
  }

  const raw = readFileSync(absPath, "utf-8");
  const { data, body } = parseFrontmatter(raw);

  const docId = data.linear_document_id;
  if (!docId) {
    console.error(`  No \`linear_document_id\` in frontmatter.`);
    return false;
  }

  const client = getClient("write");
  const content = buildSyncBanner(filePath) + body.trimEnd() + "\n";

  const result = await client.updateDocument(docId, { content });
  if (result.success) {
    const hash = computeSyncHash(body);
    data.linear_sync_hash = hash;
    const updated = buildFrontmatter(data, body);
    writeFileSync(absPath, updated, "utf-8");

    console.log(`  ${filePath} (${body.trim().length} chars, hash: ${hash})`);
    return true;
  } else {
    console.error(`  Failed to update Linear document for ${filePath}.`);
    return false;
  }
}

async function pushAll(cwd: string): Promise<void> {
  const docs = findLinearLinkedDocs(cwd);
  if (docs.length === 0) {
    console.log("No Linear-linked docs found.");
    return;
  }

  console.log(`Pushing ${docs.length} Linear-linked doc(s):\n`);
  let failed = 0;
  for (const doc of docs) {
    const ok = await push(doc.filePath);
    if (!ok) failed++;
  }

  console.log(`\n${docs.length - failed}/${docs.length} pushed successfully.`);
  if (failed > 0) process.exit(1);
}

async function pull(filePath: string, explicitDocId?: string): Promise<void> {
  const absPath = resolve(filePath);
  let docId = explicitDocId;
  let existingData: Record<string, string> = {};

  if (existsSync(absPath)) {
    const raw = readFileSync(absPath, "utf-8");
    const parsed = parseFrontmatter(raw);
    existingData = parsed.data;
    if (!docId) docId = parsed.data.linear_document_id;
  }

  if (!docId) {
    console.error("No document ID. Provide --id <doc_id> or add frontmatter.");
    process.exit(1);
  }

  const client = getClient("read");
  const doc = await client.document(docId);

  if (!doc) {
    console.error(`Linear document \`${docId}\` not found.`);
    process.exit(1);
  }

  const content = stripSyncBanner(doc.content ?? "");
  const hash = computeSyncHash(content);
  const frontmatterData: Record<string, string> = {
    ...existingData,
    linear_document_id: docId,
    linear_document_title: doc.title,
    linear_sync_hash: hash,
  };

  const output = buildFrontmatter(frontmatterData, content.trimEnd() + "\n");
  writeFileSync(absPath, output, "utf-8");

  console.log(`Pulled Linear document \`${doc.title}\` to \`${filePath}\`.`);
  console.log(`(${content.trim().length} characters)`);
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
    console.log(`Pushing 1 doc:\n`);
    const ok = await push(filePath);
    if (!ok) process.exit(1);
  } else if (command === "pull") {
    const idIdx = args.indexOf("--id");
    let docId: string | undefined;
    let filePath: string | undefined;

    if (idIdx !== -1) {
      docId = args[idIdx + 1];
      filePath = args.find(
        (a, i) => i > 0 && i !== idIdx && i !== idIdx + 1 && !a.startsWith("--")
      );
    } else {
      filePath = args[1];
    }

    if (!filePath) {
      console.error("Usage: linear-doc-sync.ts pull <file_path> [--id <doc_id>]");
      process.exit(1);
    }
    await pull(filePath, docId);
  } else {
    console.error(
      "Usage: linear-doc-sync.ts <push|pull> <file_path> [--id <doc_id>]"
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
