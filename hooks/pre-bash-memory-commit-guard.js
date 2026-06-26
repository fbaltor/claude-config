#!/usr/bin/env node
// PreToolUse(Bash) guard for the SHARED ~/memory iwe vault.
//
// Multiple concurrent `claude` sessions write ~/memory. A `git add -A | . | -u` or
// `git commit -a` there stages another live session's uncommitted notes into THIS
// session's commit — mis-attribution, and the iwe-normalize flip-flop we hit. This hook
// blocks those vault-sweeping forms and points at the scoped+locked recipe instead. It
// fires ONLY for commands targeting ~/memory, so other repos keep using `-A` normally.
//
// Conventions (see ~/.claude/CLAUDE.md): PreToolUse exits 0 on any unexpected error
// (fail-OPEN — a hook bug must never block a legit command); exit 2 = intentional block.
// Hot-path hook: plain ESM .js run via node, self-contained (no shared-lib import).

import { readFileSync } from "node:fs";
import { homedir } from "node:os";

const MEMORY = `${homedir()}/memory`;

let ev;
try {
  ev = JSON.parse(readFileSync(0, "utf8"));
} catch {
  process.exit(0); // no/garbled stdin → don't block
}

if (!ev || ev.tool_name !== "Bash") process.exit(0);
const cmd = ev.tool_input?.command;
if (typeof cmd !== "string" || !cmd) process.exit(0);

// Strip commit-MESSAGE text before scanning — heredoc bodies and quoted `-m`/`--message`
// args — so a message that merely DESCRIBES the blocked pattern (e.g. this hook's own
// commit) or names ~/memory doesn't trip the guard. Commands inside other quotes
// (`sh -c "git add -A"`) stay visible on purpose, so that abuse is still caught.
const scan = cmd
  .replace(/<<-?\s*(['"]?)([A-Za-z_]\w*)\1[\s\S]*?^\s*\2\b/gm, " <<HEREDOC ")
  .replace(/(?:^|\s)(?:-m|--message)(?:\s+|=)(?:"(?:[^"\\]|\\.)*"|'[^']*'|\S+)/g, " -m MSG ");

// Does this command operate on the memory vault? Either the shell cwd is inside it, or the
// command names the path (`cd ~/memory && …`, `git -C ~/memory …`, an absolute mention).
const cwd = typeof ev.cwd === "string" ? ev.cwd : "";
const cwdInMemory = cwd === MEMORY || cwd.startsWith(MEMORY + "/");
const mentionsMemory = /(?:~|\/home\/[^/\s]+)\/memory(?:\/|\b)/.test(scan);
if (!(cwdInMemory || mentionsMemory)) process.exit(0);

// Flag a git add/commit that stages MORE than explicit pathspecs. Split on statement
// separators (naive re quotes, but scoped `git add -- <paths>` never trips the patterns).
const sweep = scan.split(/&&|\|\||[;\n|]/).some((seg) => {
  const s = seg.trim();
  if (/\bgit\s+(?:-C\s+\S+\s+)?add\b/.test(s)) {
    if (/\s(?:-A|--all|-u|--update)\b/.test(s)) return true; // stage everything
    if (/\s\.(?:\s|$)/.test(s)) return true; // bare "." pathspec (git add . / git add -- .)
  }
  if (/\bgit\s+(?:-C\s+\S+\s+)?commit\b/.test(s)) {
    if (/\s--all\b/.test(s)) return true;
    if (/\s-[a-z]*a[a-z]*\b/.test(s)) return true; // short cluster with 'a': -a, -am, -ap…
  }
  return false;
});
if (!sweep) process.exit(0);

process.stderr.write(
  [
    "Blocked: vault-wide git staging in the shared ~/memory vault.",
    "Concurrent claude sessions write ~/memory — `git add -A|.|-u` and `git commit -a` sweep",
    "another live session's uncommitted notes into THIS commit (mis-attribution + iwe-normalize flip-flop).",
    "Stage ONLY the files you authored, by pathspec, under the vault lock:",
    "  cd ~/memory && NOTES=\"<domain>/<key>.md <hub>.md\"",
    "  flock -w 30 .git/cc-mem.lock sh -c \"iwe normalize && git add -- $NOTES && git commit -m 'memory(<domain>): …' -- $NOTES\"",
    "(see ~/.claude/skills/remember/SKILL.md step 6).",
  ].join("\n") + "\n",
);
process.exit(2);
