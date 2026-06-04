// PATH-first, Nix-native provisioning. Check whether the required binaries already resolve;
// if not, augment PATH once via a single `nix-shell -p ...` resolution and PREPEND it to the
// existing PATH (so host-only tools like `obsidian` stay reachable too).

import { run as defaultRun, type RunFn } from "./proc";

async function onPath(bin: string, env: NodeJS.ProcessEnv, run: RunFn): Promise<boolean> {
  const r = await run("sh", ["-c", 'command -v -- "$1" >/dev/null 2>&1', "sh", bin], { env });
  return r.code === 0;
}

export async function resolveToolchain(
  nixPkgs: string[],
  bins: string[],
  run: RunFn = defaultRun,
): Promise<NodeJS.ProcessEnv> {
  const env: NodeJS.ProcessEnv = { ...process.env };

  const present = await Promise.all(bins.map((b) => onPath(b, env, run)));
  const missing = bins.filter((_, i) => !present[i]);
  if (missing.length === 0) return env;

  if (nixPkgs.length === 0) {
    throw new Error(`missing executables with nothing to provision them: ${missing.join(", ")}`);
  }

  // One Nix resolution for all needed packages; capture the resulting PATH.
  const r = await run("nix-shell", ["-p", ...nixPkgs, "--run", "printenv PATH"], { env });
  if (r.code !== 0) {
    throw new Error(`nix-shell provisioning failed for [${nixPkgs.join(", ")}]: ${r.stderr.trim()}`);
  }
  const nixPath = r.stdout.trim().split("\n").filter(Boolean).pop() ?? "";
  if (!nixPath) throw new Error("nix-shell returned an empty PATH");

  // Prepend Nix bins; keep host PATH so non-Nix tools (e.g. obsidian) remain resolvable.
  return { ...env, PATH: `${nixPath}:${env.PATH ?? ""}` };
}
