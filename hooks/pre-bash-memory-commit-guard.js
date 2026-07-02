#!/usr/bin/env node
// PreToolUse(Bash) guard for the SHARED ~/memory iwe vault.
//
// Multiple concurrent `claude` sessions write ~/memory. A `git add -A | . | -u` or
// `git commit -a` there stages another live session's uncommitted notes into THIS
// session's commit — mis-attribution, and the iwe-normalize flip-flop we hit. This hook
// blocks those vault-sweeping forms and points at the scoped+locked recipe instead. It
// fires ONLY for commands targeting ~/memory, so other repos keep using `-A` normally.
//
// It also gates vault commits on graph integrity (the remember-skill step-5 checks,
// enforced instead of advisory): no dangling wiki links anywhere in the vault, and no
// committed note left as an inclusion-orphan (a non-`index` top-level root in
// `iwe tree` — inline references don't create edges, only own-line links do). The
// orphan check is scoped to the paths being committed so another session's in-flight
// WIP can never block this session's commit. Both checks are read-only.
//
// Conventions (see ~/.claude/CLAUDE.md): PreToolUse exits 0 on any unexpected error
// (fail-OPEN — a hook bug must never block a legit command); exit 2 = intentional block.
// Hot-path hook: plain ESM .js run via node, self-contained (no shared-lib import).

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const MEMORY = process.env.MEMORY_GUARD_VAULT || `${homedir()}/memory`;
// Link-syntax examples in conventions.md / pkm notes — not real targets.
const DOC_EXAMPLE_KEYS = new Set(["key", "note-key", "wikilink", "wikilinks"]);

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
const mentionsMemory =
  /(?:~|\/home\/[^/\s]+)\/memory(?:\/|\b)/.test(scan) || scan.includes(MEMORY);
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
if (sweep) {
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
}

// ---- Integrity gate: only for an actual `git commit` in the vault ------------------
if (!/\bgit\s+(?:-C\s+\S+\s+)?commit\b/.test(scan)) process.exit(0);

try {
  // 1) Dangling links — any [[key]] in any vault note must resolve to <key>.md.
  //    Vault-wide (a new file can't CREATE a dangler, so other sessions' WIP is safe).
  const linkRe = /\[\[([a-z0-9][a-z0-9/_-]*)(?:\|[^\]]*)?\]\]/g;
  const dangling = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === ".git" || e.name === ".iwe") continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".md")) {
        const text = readFileSync(p, "utf8");
        for (const m of text.matchAll(linkRe)) {
          const key = m[1];
          if (DOC_EXAMPLE_KEYS.has(key)) continue;
          if (!existsSync(join(MEMORY, `${key}.md`)))
            dangling.push(`${key}  (in ${p.slice(MEMORY.length + 1)})`);
        }
      }
    }
  };
  walk(MEMORY);
  if (dangling.length) {
    process.stderr.write(
      [
        "Blocked: dangling wiki links in ~/memory — fix before committing (remember-skill step 5).",
        ...[...new Set(dangling)].map((d) => `  DANGLING: ${d}`),
        "Usually a wrong-folder key or a renamed/missing target. Every [[key]] must resolve to <key>.md from the vault root.",
      ].join("\n") + "\n",
    );
    process.exit(2);
  }

  // 2) Inclusion-orphans — scoped to the notes THIS commit stages. A committed note must
  //    not be a non-`index` top-level root of `iwe tree` (i.e., it needs an own-line link
  //    from a hub). Paths come from the NOTES="…" assignment (the skill recipe), else
  //    literal pathspecs after ` -- `; if neither parses, skip silently (fail-open).
  const notesMatch = cmd.match(/\bNOTES=("([^"]*)"|'([^']*)')/);
  let paths = notesMatch ? (notesMatch[2] ?? notesMatch[3]).split(/\s+/) : [];
  if (!paths.length) {
    const seg = scan
      .split(/&&|\|\||[;\n|]/)
      .find((s) => /\bgit\s+(?:-C\s+\S+\s+)?commit\b/.test(s));
    const after = seg?.split(/\s--\s/)[1];
    if (after) paths = after.trim().split(/\s+/).filter((p) => !p.startsWith("$"));
  }
  const keys = paths
    .filter((p) => p.endsWith(".md"))
    .map((p) => p.replace(/^\.\//, "").replace(/\.md$/, ""))
    .filter((k) => existsSync(join(MEMORY, `${k}.md`))); // deletions can't be orphans
  if (keys.length) {
    const tree = execFileSync("iwe", ["tree", "-f", "keys", "-d", "12"], {
      cwd: MEMORY,
      timeout: 10_000,
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    });
    const roots = new Set(
      tree.split("\n").filter((l) => l && !/^[\t ]/.test(l)),
    );
    roots.delete("index");
    const orphans = keys.filter((k) => roots.has(k));
    if (orphans.length) {
      process.stderr.write(
        [
          "Blocked: committing inclusion-orphan note(s) — no hub links them (remember-skill step 3).",
          ...orphans.map((k) => `  ORPHAN: ${k}`),
          "Add the note under its domain hub's `## Notes` as a one-line hook + an OWN-LINE [[key|Title]] link",
          "(an inline `[[key]]` mid-paragraph is only a reference, not a graph edge), then retry the commit.",
        ].join("\n") + "\n",
      );
      process.exit(2);
    }
  }
} catch {
  process.exit(0); // integrity gate must never block on its own failure (iwe missing, timeout, …)
}

process.exit(0);
