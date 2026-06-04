// Core contracts for the off-screen capture orchestrator.
//
// The capability decomposes into three orthogonal layers:
//   - Backend     : owns a headless display we control + its capture/input/resize/stop primitives
//   - AppProfile  : backend-aware launch flags + instance/data isolation + navigation steps
//   - Orchestrator: lifecycle glue (start -> waitStable -> run steps -> capture -> teardown)
//
// Each consent-free path reduces to the same move: own the display the app runs in. Backends
// differ only in *which* display technology we own (sway today; Xvfb / headless Mutter later).

export interface Size {
  width: number;
  height: number;
}

// A single navigation action run against a live session.
export type Step =
  | { key: string } //  e.g. "ctrl+g", "Escape", "shift+ctrl+p"
  | { type: string } // type literal text
  | { waitStable: true; timeoutMs?: number } // wait until the frame stops changing
  | { sleep: number }; // ms

// How to launch the target app inside a backend's display.
export interface LaunchSpec {
  app: string; // binary name (resolved on PATH) or absolute path
  args?: string[];
  env?: NodeJS.ProcessEnv; // extra env merged over the display env
}

// A live, drivable headless display with the app running inside it.
export interface DisplaySession {
  readonly name: string; // backend name
  readonly env: NodeJS.ProcessEnv; // env for auxiliary clients (WAYLAND_DISPLAY / DISPLAY, ...)
  readonly outputName: string; // capture target, e.g. "HEADLESS-1"
  capture(outPath: string): Promise<void>;
  key(chord: string): Promise<void>;
  type(text: string): Promise<void>;
  resize(size: Size): Promise<void>;
  stop(): Promise<void>;
}

export interface StartOpts {
  launch: LaunchSpec;
  size: Size;
  baseEnv: NodeJS.ProcessEnv; // PATH already resolved (incl. nix-provisioned bins)
}

export interface Backend {
  readonly name: string;
  readonly nixPkgs: string[]; // packages for `nix-shell -p` when bins are missing
  readonly bins: string[]; // executables that must resolve on PATH
  start(opts: StartOpts): Promise<DisplaySession>;
}

// The result of preparing an app to be captured: what to launch, how to navigate, how to clean up.
export interface PreparedApp {
  launch: LaunchSpec;
  nav?: Step[];
  cleanup(): Promise<void>;
}

export interface AppProfile {
  readonly name: string;
  readonly nixPkgs?: string[]; // extra packages the profile needs provisioned
  readonly bins?: string[]; // extra executables the profile needs
  prepare(ctx: { backend: string; size: Size }): Promise<PreparedApp>;
}
