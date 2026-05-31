import type { Backend } from "../lib/types.ts";
import { ghostty } from "./ghostty.ts";
import { tmux } from "./tmux.ts";
import { kitty } from "./kitty.ts";
import { wezterm } from "./wezterm.ts";

// Registry. To add a backend: write backends/<name>.ts exporting a Backend,
// then add it here. Core needs no other change.
//
// Order matters for auto-detection: the first backend whose autoDetect()
// returns true wins. Pane-capable backends come before the window-only
// fallback so an active multiplexer is preferred over a bare new window.
export const BACKENDS: Backend[] = [tmux, wezterm, kitty, ghostty];

/** The backend used when nothing auto-detects and no --backend is given. */
export const DEFAULT_BACKEND = ghostty;

export function byName(name: string): Backend | undefined {
  return BACKENDS.find((b) => b.name === name);
}
