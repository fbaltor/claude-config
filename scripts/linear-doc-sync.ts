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

import { LinearClient } from "@linear/sdk";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const SYNC_BANNER_PATTERN = /^> \*\*Source of truth:\*\*[^\n]*\n\n---\n\n/;

function getClient(scope: "read" | "write"): LinearClient {
  const envVar = scope === "write" ? "LINEAR_API_KEY_ALL" : "LINEAR_API_KEY_READ";
  const apiKey = process.env[envVar] ?? process.env.LINEAR_API_KEY;
  if (!apiKey) {
    console.error(`${envVar} (or LINEAR_API_KEY) not set.`);
    process.exit(1);
  }
  return new LinearClient({ apiKey });
}

interface Frontmatter {
  data: Record<string, string>;
  body: string;
}

function parseFrontmatter(content: string): Frontmatter {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { data: {}, body: content };

  const data: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx > 0) {
      data[line.slice(0, colonIdx).trim()] = line.slice(colonIdx + 1).trim();
    }
  }
  return { data, body: match[2].replace(/^\n/, "") };
}

function buildFrontmatter(data: Record<string, string>, body: string): string {
  const lines = Object.entries(data).map(([k, v]) => `${k}: ${v}`);
  return `---\n${lines.join("\n")}\n---\n\n${body}`;
}

function buildSyncBanner(filePath: string): string {
  const repoUrl = `https://github.com/Jumpstart-Immigration/jumpstart/blob/main/${filePath}`;
  return (
    `> **Source of truth:** [\`${filePath}\`](${repoUrl}) in the \`jumpstart\` repo. ` +
    `This Linear document is auto-synced — edit the git version first.\n\n---\n\n`
  );
}

function stripSyncBanner(content: string): string {
  return content.replace(SYNC_BANNER_PATTERN, "");
}

async function push(filePath: string): Promise<void> {
  const absPath = resolve(filePath);
  if (!existsSync(absPath)) {
    console.error(`File not found: ${absPath}`);
    process.exit(1);
  }

  const raw = readFileSync(absPath, "utf-8");
  const { data, body } = parseFrontmatter(raw);

  const docId = data.linear_document_id;
  if (!docId) {
    console.error("No `linear_document_id` found in frontmatter.");
    console.error(
      "Add frontmatter like:\n---\nlinear_document_id: <uuid>\n---"
    );
    process.exit(1);
  }

  const client = getClient("write");
  const content = buildSyncBanner(filePath) + body.trimEnd() + "\n";

  const result = await client.updateDocument(docId, { content });
  if (result.success) {
    console.log(`Pushed \`${filePath}\` to Linear document \`${docId}\`.`);
    console.log(`(${body.trim().length} characters)`);
  } else {
    console.error("Failed to update Linear document.");
    process.exit(1);
  }
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
  const frontmatterData: Record<string, string> = {
    ...existingData,
    linear_document_id: docId,
    linear_document_title: doc.title,
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
      console.error("Usage: linear-doc-sync.ts push <file_path>");
      process.exit(1);
    }
    await push(filePath);
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
