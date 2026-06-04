// Small process helpers. All external tools (sway, grim, wtype, the app) are spawned through here,
// so "all the wrapping is in TS" — no bash glue.

import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream } from "node:fs";

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface RunOpts {
  env?: NodeJS.ProcessEnv;
  input?: string;
}

// The shape of `run`, so callers can inject a fake runner in tests.
export type RunFn = (cmd: string, args: string[], opts?: RunOpts) => Promise<RunResult>;

// Run a command to completion, collecting stdout/stderr.
export function run(cmd: string, args: string[], opts: RunOpts = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env: opts.env ?? process.env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    if (opts.input != null) child.stdin.end(opts.input);
  });
}

// Run, throwing on non-zero exit.
export async function runOk(cmd: string, args: string[], opts: RunOpts = {}): Promise<RunResult> {
  const r = await run(cmd, args, opts);
  if (r.code !== 0) {
    throw new Error(`\`${cmd} ${args.join(" ")}\` exited ${r.code}: ${r.stderr.trim() || r.stdout.trim()}`);
  }
  return r;
}

// Resolve an executable to an absolute path using the given env's PATH.
// We resolve up-front and spawn by absolute path so executable lookup never depends on
// libuv's (version-dependent) choice of parent-vs-child PATH.
export async function which(bin: string, env: NodeJS.ProcessEnv): Promise<string> {
  if (bin.includes("/")) return bin;
  const r = await run("sh", ["-c", 'command -v -- "$1"', "sh", bin], { env });
  const p = r.stdout.trim().split("\n").pop() ?? "";
  if (r.code !== 0 || !p) throw new Error(`executable not found on PATH: ${bin}`);
  return p;
}

// Spawn a long-lived process in its own process group (detached) so we can kill the whole tree.
export function spawnBg(
  cmd: string,
  args: string[],
  opts: { env?: NodeJS.ProcessEnv; logPath?: string } = {},
): ChildProcess {
  const child = spawn(cmd, args, {
    env: opts.env ?? process.env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (opts.logPath) {
    const ws = createWriteStream(opts.logPath);
    child.stdout?.pipe(ws);
    child.stderr?.pipe(ws);
  }
  return child;
}

// Kill a detached child and everything in its process group.
export function killGroup(child: ChildProcess | undefined, signal: NodeJS.Signals = "SIGKILL"): void {
  if (!child || child.pid == null) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      /* already gone */
    }
  }
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// Poll a condition until it is true or the timeout elapses.
export async function waitFor(
  cond: () => Promise<boolean> | boolean,
  opts: { timeoutMs: number; intervalMs?: number },
): Promise<boolean> {
  const t0 = Date.now();
  const iv = opts.intervalMs ?? 200;
  while (Date.now() - t0 < opts.timeoutMs) {
    if (await cond()) return true;
    await sleep(iv);
  }
  return false;
}
