// SUITE 4 — select: backend resolution + split reconciliation.
//
// NOTE on PATH-dependence: explicit selection of an *available* backend depends
// on the real PATH (Backend.isAvailable greps PATH for the terminal binary),
// which is not hermetic. So this suite exercises only the two PATH-INDEPENDENT
// paths:
//   - the default path (no requested backend, no autoDetect match) -> ghostty,
//     a window-only backend that is returned without an isAvailable() gate; and
//   - the throw path for an unknown backend name (rejected before isAvailable).
//
// NOTE on warnOnce: util.warnOnce uses a module-level `warned` flag and fires at
// most once per process. Across the multiple select() calls in this suite the
// stderr warning would only appear once, so we do NOT assert on stderr — we
// assert on the returned `split` value (dropped == undefined), which is the
// observable contract regardless of warning state.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { select } from "./select.ts";

describe("select", () => {
  it("default backend is ghostty (window-only) when nothing is requested/auto-detected", () => {
    // Empty env: no $TMUX etc., so no pane backend auto-detects -> DEFAULT_BACKEND.
    const { backend } = select({}, undefined, undefined);
    assert.equal(backend.name, "ghostty");
    assert.equal(backend.capabilities.tier, "window-only");
  });

  it("--split on the window-only default is dropped (returned split is undefined)", () => {
    const { backend, split } = select({}, undefined, "h");
    assert.equal(backend.name, "ghostty");
    assert.equal(split, undefined);
  });

  it("--split v on the window-only default is also dropped", () => {
    const { split } = select({}, undefined, "v");
    assert.equal(split, undefined);
  });

  it("unknown requested backend throws", () => {
    assert.throws(
      () => select({}, "zzz-nonexistent", undefined),
      /unknown backend/,
    );
  });
});
