#!/usr/bin/env -S npx tsx
// CLI entry point.
//
//   npx tsx cli.ts --backend sway --profile obsidian --vault ~/memory --view graph --out graph.png
//
// Backends and profiles are registries so new ones drop in without touching the CLI.

import os from "node:os";
import path from "node:path";

import { capture } from "./src/orchestrator";
import { swayBackend } from "./src/backends/sway";
import { obsidianProfile } from "./src/profiles/obsidian";
import type { AppProfile, Backend } from "./src/types";
import { parseArgs, parseSize, type Args } from "./src/util";

const backends: Record<string, Backend> = {
  sway: swayBackend,
};

function buildProfile(name: string, a: Args): AppProfile {
  switch (name) {
    case "obsidian": {
      const vault = a.vault ? String(a.vault) : path.join(os.homedir(), "memory");
      const view = (a.view as "graph" | "default") ?? "graph";
      return obsidianProfile({ vault, view });
    }
    default:
      throw new Error(`unknown profile: ${name}`);
  }
}

async function main(): Promise<void> {
  const a = parseArgs(process.argv.slice(2));

  const backendName = String(a.backend ?? "sway");
  const backend = backends[backendName];
  if (!backend) {
    throw new Error(`unknown backend "${backendName}" (have: ${Object.keys(backends).join(", ")})`);
  }

  const profileName = String(a.profile ?? "obsidian");
  const profile = buildProfile(profileName, a);

  const out = path.resolve(String(a.out ?? "capture.png"));
  const size = a.size ? parseSize(String(a.size)) : undefined;
  const settleTimeoutMs = a.settle ? Number(a.settle) : undefined;

  process.stderr.write(`[offscreen-capture] backend=${backendName} profile=${profileName} -> ${out}\n`);
  await capture({ backend, profile, out, size, settleTimeoutMs });
  process.stderr.write(`[offscreen-capture] done -> ${out}\n`);
}

main().catch((e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e);
  process.stderr.write(`[offscreen-capture] ERROR: ${msg}\n`);
  process.exit(1);
});
