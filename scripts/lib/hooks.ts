/**
 * Shared types and utilities for Claude Code hooks.
 *
 * The hook runner passes JSON via stdin describing the tool call context.
 * See: https://docs.anthropic.com/en/docs/claude-code/hooks
 */

// ---------------------------------------------------------------------------
// Hook input types (passed via stdin by the Claude Code hook runner)
// ---------------------------------------------------------------------------

export interface HookToolResponse {
  stdout: string;
  stderr: string;
  interrupted: boolean;
}

export interface HookInput {
  session_id: string;
  transcript_path: string;
  cwd: string;
  permission_mode: string;
  hook_event_name: string;
  tool_name: string;
  tool_input: { command: string; description?: string };
  tool_response: HookToolResponse;
  tool_use_id: string;
}

// ---------------------------------------------------------------------------
// Stdin reader
// ---------------------------------------------------------------------------

export async function readHookStdin(): Promise<HookInput> {
  const raw = await new Promise<string>((resolve) => {
    let data = "";
    process.stdin.on("data", (chunk: Buffer | string) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
  });
  return JSON.parse(raw) as HookInput;
}
