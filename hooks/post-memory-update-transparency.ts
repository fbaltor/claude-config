#!/usr/bin/env npx tsx
/**
 * Post-memory-write transparency hook.
 *
 * Fires after a successful iwe-memory MCP write tool (create/update/extract/
 * rename/delete/inline/squash) and surfaces a user-visible `systemMessage`
 * line — the iwe equivalent of native auto-memory's "Updating memory…" signal.
 *
 * Why this exists: the iwe long-term memory at `~/memory` is written by the
 * model invoking the `remember` skill / iwe-memory MCP tools, with no built-in
 * UI indicator. This hook makes every graph write visible without changing the
 * model's judgment about *what* to remember (that stays semantic, model-driven).
 *
 * Registered (PostToolUse, matcher = mcp__iwe-memory__iwe_(create|update|
 * extract|rename|delete|inline|squash)) in ~/.claude/settings.json.
 */

import { readHookStdin, logHook } from "../scripts/lib/hooks.ts";

const TAG = "post-mem";

async function main(): Promise<void> {
  const input = await readHookStdin(TAG);

  // MCP tool_input is not the Bash {command} shape — read it generically.
  const ti = input.tool_input as unknown as Record<string, unknown>;

  // Preview / discovery modes don't mutate the graph — stay silent.
  if (ti.dry_run === true || ti.list === true) process.exit(0);
  // Interrupted call didn't complete the write.
  if (input.tool_response?.interrupted) process.exit(0);

  const str = (v: unknown): string | undefined =>
    typeof v === "string" && v.length > 0 ? v : undefined;

  const tool = input.tool_name.replace(/^.*iwe_/, "iwe_");
  let detail: string;
  switch (tool) {
    case "iwe_create":
      detail = `created note “${str(ti.title) ?? "(untitled)"}”`;
      break;
    case "iwe_update":
      detail = `updated ${str(ti.key) ?? "a note"}`;
      break;
    case "iwe_extract":
      detail = `extracted a section from ${str(ti.key) ?? "a note"} into a new note`;
      break;
    case "iwe_rename":
      detail = `renamed ${str(ti.old_key) ?? "a note"} → ${str(ti.new_key) ?? "?"}`;
      break;
    case "iwe_delete":
      detail = `deleted ${str(ti.key) ?? "a note"}`;
      break;
    case "iwe_inline":
      detail = `inlined into ${str(ti.key) ?? "a note"}`;
      break;
    case "iwe_squash":
      detail = `squashed ${str(ti.key) ?? "a note"}`;
      break;
    default:
      detail = `wrote to the graph (${tool})`;
  }

  const systemMessage = `📝 Long-term memory (~/memory) updated — ${detail}`;
  logHook(TAG, systemMessage);

  // `systemMessage` is shown to the user; `suppressOutput` keeps raw stdout
  // out of the transcript so only the clean line surfaces.
  process.stdout.write(JSON.stringify({ systemMessage, suppressOutput: true }));
  process.exit(0);
}

main().catch((err) => {
  logHook(TAG, `ERROR: ${err.message}\n${err.stack ?? ""}`);
  process.exit(1); // non-zero so failures are visible
});
