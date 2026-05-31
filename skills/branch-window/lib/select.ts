import type { Backend, Split } from "./types.ts";
import { warnOnce } from "./util.ts";
import { BACKENDS, DEFAULT_BACKEND, byName } from "../backends/index.ts";

export interface Selection {
  backend: Backend;
  /** Split to actually use after capability filtering (undefined = none). */
  split?: Split;
}

/**
 * Resolve which backend to use and reconcile the requested split against that
 * backend's capabilities.
 *
 * Precedence:
 *   1. explicit `requested` name (errors if unknown / unavailable)
 *   2. first registered backend whose autoDetect() is true AND isAvailable()
 *   3. DEFAULT_BACKEND (ghostty)
 *
 * Capability reconciliation (generalized — every window-only backend inherits):
 *   - --split on a window-only backend  -> warn once, drop the split
 *   - --split a pane backend doesn't list -> warn once, drop the split
 */
export function select(
  env: NodeJS.ProcessEnv,
  requested: string | undefined,
  split: Split | undefined,
): Selection {
  const backend = resolveBackend(env, requested);
  const effectiveSplit = reconcileSplit(backend, split);
  return { backend, split: effectiveSplit };
}

function resolveBackend(
  env: NodeJS.ProcessEnv,
  requested: string | undefined,
): Backend {
  if (requested) {
    const b = byName(requested);
    if (!b) {
      const names = BACKENDS.map((x) => x.name).join(", ");
      throw new Error(`unknown backend "${requested}". Available: ${names}`);
    }
    if (!b.isAvailable(env)) {
      throw new Error(`backend "${requested}" is not available (binary not on PATH)`);
    }
    return b;
  }

  const auto = BACKENDS.find(
    (b) => b.capabilities.autoDetect(env) && b.isAvailable(env),
  );
  if (auto) return auto;

  return DEFAULT_BACKEND;
}

function reconcileSplit(
  backend: Backend,
  split: Split | undefined,
): Split | undefined {
  if (!split) return undefined;

  const { tier, splits } = backend.capabilities;
  if (tier === "window-only") {
    warnOnce(
      `${backend.name} is window-only; --split ${split} ignored, opening a new window`,
    );
    return undefined;
  }
  if (!splits.includes(split)) {
    warnOnce(
      `${backend.name} does not support --split ${split}; ignoring`,
    );
    return undefined;
  }
  return split;
}
