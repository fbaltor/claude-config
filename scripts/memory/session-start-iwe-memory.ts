/**
 * SessionStart hook — inject the iwe memory "map" for progressive recall.
 *
 * Replaces Claude Code's preloaded auto-memory (now the default; `claude
 * --native` opts back into native) with the ~/memory iwe library, recalled on
 * demand (plan:
 * ~/.claude/plans/2026-06-04-iwe-as-cc-memory-implementation-plan.md).
 *
 * At session start we inject ONLY the ~17-line domain map (index.md) plus a short
 * recall/remember protocol — never the facts themselves. Facts are paged in on
 * demand via `iwe find` / `iwe retrieve`.
 *
 * Gated by env CC_MEM (DEFAULT-ON; the `claude` wrapper sets CC_MEM=map unless
 * `--native` is passed):
 *   unset / off -> inject nothing (e.g. `claude --native` — native memory active)
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
const INDEX = `${HOME}/memory/index.md`;

// Local ISO-8601 timestamp: same sortable shape as toISOString() but in the
// system timezone with a real offset (e.g. -03:00) instead of forced-UTC "Z",
// so the log reads in local time and matches `date`/`watch` output.
const localTimestamp = (d = new Date()): string => {
  const pad = (n: number, w = 2) => String(Math.abs(n)).padStart(w, "0");
  const off = -d.getTimezoneOffset(); // minutes east of UTC
  const sign = off >= 0 ? "+" : "-";
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `.${pad(d.getMilliseconds(), 3)}${sign}${pad(off / 60)}:${pad(off % 60)}`
  );
};

// Default-on: the `claude` wrapper sets CC_MEM=map unless `--native` is passed.
// Inject only when CC_MEM selects a memory mode; unset / "off" (e.g. --native)
// => native auto-memory, no map injected.
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
  "## Long-term memory — iwe library at `~/memory` (progressive recall)",
  "",
  "Your durable memory is the iwe note-graph mapped below (the `index` MOC). It is **not** preloaded — only this map is. Recall facts **on demand**:",
  "- **MCP tools (this session):** `iwe_find`, `iwe_retrieve`, `iwe_tree`, `iwe_stats` operate on the graph natively — prefer them. The `iwe …` CLI from `~/memory` is the exact equivalent.",
  "- Locate: `iwe find <query>` — fuzzy match on title/key.",
  "- Page in a branch: `iwe retrieve -k <key> -d 2 -c 1` — the note + its inclusion children + parent/backlink context. Children are real edges, so `-d` walks the hub→leaf subtree; start at `iwe retrieve -k index -d 1` and descend, `--dry-run` to budget before a high `-d`.",
  "- Persist a durable fact (write a note / `iwe_create`, then `iwe_normalize`) via the `remember` skill.",
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
    `[${localTimestamp()}] iwe-memory ACTIVE (CC_MEM=${mode}) — injected ${protocol.length} chars from ${INDEX}\n`,
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
