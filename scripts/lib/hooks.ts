/**
 * Shared types and utilities for Claude Code hooks.
 *
 * The hook runner passes JSON via stdin describing the tool call context.
 * Docs: https://code.claude.com/docs/en/hooks.md
 *
 * IMPORTANT: The types below were captured from the actual hook runner output
 * (2026-03-24) and may differ from the official docs. If a hook starts failing
 * silently, dump stdin to a file to verify the current schema:
 *
 *   { "type": "command", "command": "cat > /tmp/hook-stdin-dump.json" }
 */

import { appendFileSync } from "node:fs";

// ---------------------------------------------------------------------------
// Hook input types (based on actual hook runner output, NOT the docs)
// ---------------------------------------------------------------------------

/** Bash tool response as actually sent by the hook runner. */
export interface BashToolResponse {
  stdout: string;
  stderr: string;
  interrupted: boolean;
  isImage: boolean;
  noOutputExpected: boolean;
}

/**
 * Hook input passed via stdin by the Claude Code hook runner.
 *
 * This is the Bash-specific shape. Other tools (Edit, Read, etc.) have
 * different tool_input/tool_response shapes — extend as needed.
 *
 * NOTE: PreToolUse hooks do NOT receive tool_response.
 */
export interface HookInput {
  session_id: string;
  transcript_path: string;
  cwd: string;
  permission_mode: string;
  hook_event_name: "PreToolUse" | "PostToolUse" | "PostToolUseFailure";
  tool_name: string;
  tool_input: { command: string; description?: string };
  tool_response: BashToolResponse;
  tool_use_id: string;
}

// ---------------------------------------------------------------------------
// Debug log
// ---------------------------------------------------------------------------

const LOG_FILE = `${process.env.HOME}/.claude/hooks/hook-debug.log`;

export function logHook(prefix: string, msg: string): void {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${prefix}: ${msg}\n`;
  process.stderr.write(line);
  try {
    appendFileSync(LOG_FILE, line);
  } catch {
    // ignore write errors
  }
}

// ---------------------------------------------------------------------------
// Stdin reader
// ---------------------------------------------------------------------------

export async function readHookStdin(hookName: string): Promise<HookInput> {
  const raw = await new Promise<string>((resolve) => {
    let data = "";
    process.stdin.on("data", (chunk: Buffer | string) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
  });

  try {
    return JSON.parse(raw) as HookInput;
  } catch (err) {
    // Dump raw stdin so we can diagnose schema changes
    logHook(hookName, `STDIN PARSE ERROR: ${(err as Error).message}`);
    logHook(hookName, `RAW STDIN: ${raw.slice(0, 500)}`);
    throw err;
  }
}
