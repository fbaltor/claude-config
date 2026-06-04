// Aggregate entry point so the suite runs with a plain `npx tsx test/index.ts`
// (node:test executes registered tests at process exit and sets the exit code on failure).
// Integration coverage for the sway backend + orchestrator is intentionally excluded here —
// it needs the GUI stack and is exercised by the live capture run, not this hermetic suite.

import "./util.test";
import "./toolchain.test";
import "./readiness.test";
import "./obsidian-profile.test";
