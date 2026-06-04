// Lifecycle glue: resolve the toolchain, prepare the app, bring up the backend with the app
// inside it, wait for it to settle, run navigation steps, capture, and always tear down.

import type { AppProfile, Backend, DisplaySession, Size, Step } from "./types";
import { resolveToolchain } from "./toolchain";
import { waitStable } from "./readiness";
import { sleep } from "./proc";

export interface CaptureRequest {
  backend: Backend;
  profile: AppProfile;
  out: string;
  size?: Size;
  settleTimeoutMs?: number;
}

async function runStep(session: DisplaySession, step: Step): Promise<void> {
  if ("key" in step) await session.key(step.key);
  else if ("type" in step) await session.type(step.type);
  else if ("sleep" in step) await sleep(step.sleep);
  else if ("waitStable" in step) await waitStable(session, { timeoutMs: step.timeoutMs ?? 15000 });
}

export async function capture(req: CaptureRequest): Promise<void> {
  const size = req.size ?? { width: 1680, height: 1050 };

  // Resolve everything the backend AND the profile need, in one provisioning pass.
  const nixPkgs = [...req.backend.nixPkgs, ...(req.profile.nixPkgs ?? [])];
  const bins = [...req.backend.bins, ...(req.profile.bins ?? [])];
  const baseEnv = await resolveToolchain(nixPkgs, bins);

  const prepared = await req.profile.prepare({ backend: req.backend.name, size });
  const session = await req.backend.start({ launch: prepared.launch, size, baseEnv });
  try {
    await waitStable(session, { timeoutMs: req.settleTimeoutMs ?? 30000 });
    for (const step of prepared.nav ?? []) await runStep(session, step);
    await session.capture(req.out);
  } finally {
    await session.stop().catch(() => {});
    await prepared.cleanup().catch(() => {});
  }
}
