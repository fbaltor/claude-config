/**
 * SessionStart hook — inject the iwe memory "map" for progressive recall.
 *
 * Part of the experiment to replace Claude Code's preloaded auto-memory with the
 * ~/memory-iwe iwe library, recalled on demand (plan:
 * ~/.claude/plans/2026-06-04-iwe-as-cc-memory-implementation-plan.md).
 *
 * At session start we inject ONLY the ~17-line domain map (index.md) plus a short
 * recall/remember protocol — never the facts themselves. Facts are paged in on
 * demand via `iwe find` / `iwe retrieve`.
 *
 * Gated by env CC_MEM (OPT-IN; the `claude --iwe` launcher sets it):
 *   unset / off -> inject nothing (normal session — native memory unaffected)
 *   map         -> inject the domain map + protocol
 *   primer      -> (future) map + auto-recalled hub
 *
 * Fails safe: any error / missing library / off => inject nothing, exit 0.
 * Output contract: a single JSON object on stdout whose
 * hookSpecificOutput.additionalContext is silently merged into the session.
 * stdin is intentionally ignored (we need none of the SessionStart payload).
 */
import { appendFileSync, readFileSync } from "node:fs";

const HOME = process.env.HOME ?? "";
const INDEX = `${HOME}/memory-iwe/index.md`;

// Opt-in: inject only when CC_MEM explicitly selects a memory mode (set by the
// `claude --iwe` launcher). Unset / "off" / anything else => normal session,
// native auto-memory untouched, no map injected.
const mode = (process.env.CC_MEM ?? "off").trim().toLowerCase();
if (mode !== "map" && mode !== "primer") process.exit(0);

let map = "";
try {
  map = readFileSync(INDEX, "utf8").trim();
} catch {
  process.exit(0); // no library on this box
}
if (!map) process.exit(0);

const protocol = [
  "## Long-term memory — iwe library at `~/memory-iwe` (progressive recall)",
  "",
  "Your durable memory is the iwe note-graph mapped below. It is **not** preloaded — only this domain map is. Recall facts **on demand**:",
  "- Locate: `iwe find <query>` run from `~/memory-iwe` — fuzzy match on title/key.",
  "- Page in: `iwe retrieve -k <key> -d 2 -c 1` — returns the note + its children + parent/backlink context; follow `[](key)` links to widen.",
  "- Persist a durable fact you learn by writing/updating a note then `iwe normalize` (the `remember` skill wraps this).",
  "",
  "**Recall before answering** about the user, their projects, preferences, machines, tooling, or past decisions — do not assume a fact is already in context. Domains:",
  "",
  map,
].join("\n");

// Durable activation breadcrumb — written ONLY when we actually inject, so
// `tail ~/.claude/hooks/iwe-memory.log` objectively confirms iwe memory was
// active for a session (normal sessions leave no line). Best-effort.
try {
  appendFileSync(
    `${HOME}/.claude/hooks/iwe-memory.log`,
    `[${new Date().toISOString()}] iwe-memory ACTIVE (CC_MEM=${mode}) — injected ${protocol.length} chars from ${INDEX}\n`,
  );
} catch {
  // logging must never block the session
}

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: protocol,
    },
  }),
);
process.exit(0);
