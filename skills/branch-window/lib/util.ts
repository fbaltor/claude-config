import { existsSync } from "node:fs";
import { join } from "node:path";

/** True if `bin` is found on any PATH entry (executable bit not checked). */
export function hasBin(bin: string, env: NodeJS.ProcessEnv): boolean {
  const path = env.PATH ?? "";
  return path.split(":").some((dir) => dir && existsSync(join(dir, bin)));
}

let warned = false;

/** Emit a warning to stderr at most once per process. */
export function warnOnce(msg: string): void {
  if (warned) return;
  warned = true;
  process.stderr.write(`branch-window: ${msg}\n`);
}
