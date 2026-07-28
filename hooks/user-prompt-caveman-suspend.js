#!/usr/bin/env node
// caveman deep-dive suspend — UserPromptSubmit hook
//
// Caveman's minimalism is great for execution turns and bad for the phase where
// the user is still building a mental model of an unfamiliar domain. This hook
// detects research/investigation intent and puts caveman into a STICKY suspended
// state so multi-turn deep dives get full explanatory prose, including on bare
// follow-ups like "why?" that carry no signal of their own.
//
// State machine (one prompt = one transition):
//
//   not suspended --[ENTER matched]-------------------------> SUSPENDED
//   SUSPENDED     --[RESUME matched AND no ENTER match]-----> not suspended
//   SUSPENDED     --[anything else]-------------------------> SUSPENDED (sticky)
//
// ENTER always beats RESUME. "explain how to implement X" is a question, not a
// work order, so it suspends; and while suspended, "why does the build fail"
// keeps the suspension instead of being torn out by the word "build".
//
// Two mechanisms enforce the suspension, because one is not enough:
//   1. The plugin's `.caveman-active` flag is moved aside (its mode stashed in
//      our own state file). That silences the plugin's per-turn "CAVEMAN MODE
//      ACTIVE" reinforcement at the source and clears the statusline badge.
//   2. A counter-instruction is injected every suspended turn, because the
//      SessionStart hook already dumped the full caveman ruleset into context
//      and deleting a file cannot retract that.
//
// Manual control, highest precedence: "pause caveman" / "resume caveman".
// Any `/caveman ...` command (or the plugin's own natural-language on/off
// phrases) hands control back to the plugin and clears our state — EXCEPT the
// informational `/caveman-stats` / `/caveman-help`, which never touch the flag,
// so a suspension survives them.
//
// The plugin-trigger mirror below (wantsOff / isQuestion / wantsOn) is copied
// from the plugin's caveman-mode-tracker.js @ 0d95a81 (v1.9.1). It is
// version-coupled: re-verify after every `/plugin` update of caveman.
//
// Hot-path hook: plain ESM `.js` run via node, self-contained, no shared lib.
// Silent-fails on every filesystem error — never block a prompt.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const flagPath = path.join(claudeDir, '.caveman-active');
const suspendPath = path.join(claudeDir, '.caveman-suspend');

const VALID_MODES = [
  'lite', 'full', 'ultra',
  'wenyan-lite', 'wenyan', 'wenyan-full', 'wenyan-ultra',
  'commit', 'review', 'compress',
];

// Modes with their own skill behavior — leave them alone entirely.
const INDEPENDENT_MODES = new Set(['commit', 'review', 'compress']);

// --- Intent detection -------------------------------------------------------

// Research / study intent. Deliberately biased toward false positives: a wrongly
// verbose answer costs a few tokens, a wrongly terse one costs comprehension.
const ENTER = [
  /\b(investigat|research|stud(?:y|ies|ying)|explor|analy[sz])\w*\b/,
  /\bdeep[- ]?dives?\b/,
  /\b(explain|clarify|elaborate)\b/,
  /\b(walk|talk) me through\b/,
  /\bteach me\b/,
  /\bhelp me understand\b/,
  /\b(under|to under)stand(ing)? (how|why|what|the|this|that|it)\b/,
  /\bdon'?t (fully )?understand\b/,
  /\bhow (do(es)?|did|is|are|was|were|would|can|could|should|it|they|this|that|the|we|you)\b/,
  /\bhow .{0,40}\bworks?\b/,
  /\bwhy (do(es)?|did|is|are|was|were|would|not|no|can|could|should|the|this|that|we|you|it)\b/,
  /\bwhat (is|are|was|were|do(es)?|did|happens|kind|sort|exactly)\b/,
  /\bwhat'?s (the|a|an|going|happening|actually)\b/,
  /\bwhere (do(es)?|is|are|did)\b/,
  /\bwhen (do(es)?|is|are|did|should)\b/,
  /\bwhich (approach|option|one|way|of|is)\b/,
  /\btrade[- ]?offs?\b/,
  /\bpros and cons\b/,
  /\b(compare|comparison)\b/,
  /\bdifference between\b/,
  /\bversus\b/,
  /\brationale\b/,
  /\breasoning\b/,
  /\bunder the hood\b/,
  /\bmental model\b/,
  /\bbig picture\b/,
  /\bfirst principles\b/,
  /\boverview\b/,
  /\b(give me|need|want) (the |some |more )?context\b/,
  /\bcontext on\b/,
  /\bshould i\b/,
  /\bread (up )?(on|about)\b/,
  /\blearn(ing)? (about|how|the)\b/,
  /\bmake sure i (understand|get)\b/,
];

// Execution intent — the signal that the deep dive is over and work begins.
const RESUME = [
  /\b(implement|fix|refactor|rename|patch|apply|migrate|install|commit|push|merge|ship|deploy|revert|rollback|scaffold)\b/,
  /\b(write|create|add|remove|delete|update|edit|change|build|run|execute|generate|make|wire|hook) (it|the|this|that|a|an|these|those|them|us|me|up)\b/,
  /\bgo ahead\b/,
  /\bdo it\b/,
  /\bproceed\b/,
  /\bmake it so\b/,
  /\bship it\b/,
  /\blgtm\b/,
  /\blet'?s (do|build|write|implement|start|go|fix|add|ship)\b/,
  /\bnow (do|fix|implement|write|add|make|build|run|apply|change)\b/,
  /\b(start|begin) (implementing|coding|working|building|writing)\b/,
  /\bexecute the plan\b/,
  /\bcarry (it |this )?out\b/,
];

const matchesAny = (list, text) => list.some((re) => re.test(text));

// --- Flag-file IO (symlink-safe, size-capped, whitelist-validated) ----------

function refusesSymlink(p) {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch (e) {
    return e.code !== 'ENOENT';
  }
}

function readSmallFile(p, maxBytes) {
  try {
    const st = fs.lstatSync(p);
    if (st.isSymbolicLink() || !st.isFile() || st.size > maxBytes) return null;
    return fs.readFileSync(p, 'utf8');
  } catch (e) {
    return null;
  }
}

function readMode() {
  const raw = readSmallFile(flagPath, 64);
  if (raw === null) return null;
  const mode = raw.trim().toLowerCase();
  return VALID_MODES.includes(mode) ? mode : null;
}

function writeSmallFile(p, content) {
  try {
    if (refusesSymlink(p) || refusesSymlink(path.dirname(p))) return;
    const tmp = `${p}.${process.pid}.tmp`;
    const fd = fs.openSync(
      tmp,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0),
      0o600,
    );
    try {
      fs.writeSync(fd, String(content));
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, p);
  } catch (e) {
    /* best-effort */
  }
}

const unlinkQuiet = (p) => {
  try {
    fs.unlinkSync(p);
  } catch (e) {
    /* already gone */
  }
};

// Read the stashed mode we took the plugin's flag away from.
// `manual` marks a suspension the user asked for by name — those never lift on
// a heuristic guess, only on an explicit "resume caveman" or /caveman command.
function readSuspend() {
  const raw = readSmallFile(suspendPath, 256);
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw);
    const mode = String(parsed.mode || '').toLowerCase();
    return {
      mode: VALID_MODES.includes(mode) ? mode : 'lite',
      manual: parsed.manual === true,
    };
  } catch (e) {
    return { mode: 'lite', manual: false };
  }
}

function suspend(mode, manual = false) {
  writeSmallFile(suspendPath, JSON.stringify({ mode, manual }));
  unlinkQuiet(flagPath); // silences the plugin's per-turn reinforcement
}

function unsuspend(mode) {
  unlinkQuiet(suspendPath);
  writeSmallFile(flagPath, mode);
}

// --- Injected counter-instruction -------------------------------------------

const SUSPEND_CONTEXT = [
  'DEEP-DIVE MODE ACTIVE — caveman style is SUSPENDED.',
  '',
  'This OVERRIDES every caveman instruction elsewhere in context, including the',
  'SessionStart ruleset and any "CAVEMAN MODE ACTIVE" per-turn reminder. Ignore',
  'them completely while this block is present.',
  '',
  'Write full natural English prose: complete sentences, articles, connectives,',
  'explicit causal links ("because", "which means", "so that"). Give the reasoning',
  'and the mechanism, not just the conclusion — name what happens, why it happens',
  'that way, and what follows from it. Define terms on first use. Depth beats',
  'brevity here; the user is building understanding of unfamiliar ground, and',
  'compressed fragments are actively costing them comprehension.',
  '',
  'Still forbidden: sycophancy, filler openers, padding, restating the question.',
  'Verbose does not mean bloated — every sentence must carry information.',
  '',
  'Suspension lifts on an execution-intent prompt (implement / fix / commit / do it),',
  'or immediately on "resume caveman".',
].join('\n');

const emit = (text) =>
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: text,
      },
    }),
  );

// --- Main -------------------------------------------------------------------

let input = '';
process.stdin.on('data', (chunk) => {
  input += chunk;
});
process.stdin.on('end', () => {
  try {
    // Collapse whitespace exactly like the tracker (#598) so phrase triggers
    // match multiline prompts identically on both sides of the mirror.
    const lower = (JSON.parse(input).prompt || '').trim().toLowerCase().replace(/\s+/g, ' ');

    // 1. Explicit caveman commands belong to the plugin. Step out of the way and
    //    drop our state so we never fight a deliberate user choice. wantsOff /
    //    isQuestion / wantsOn are VERBATIM from caveman-mode-tracker.js @ 0d95a81
    //    (v1.9.1), combined exactly as the tracker combines them (wantsOff is
    //    ungated; activation only fires when neither wantsOff nor isQuestion).
    //    Informational /caveman-stats & /caveman-help never touch the flag, so
    //    they fall through and a suspension survives them.
    const informational = /^\/caveman(?::caveman)?-(stats|help)\b/.test(lower);

    const wantsOff =
      /\b(stop|disable|deactivate|quit|exit|kill)\s+(the\s+)?caveman\b/.test(lower) ||
      /\bcaveman(\s+mode)?\s+(off|stop|disabled?)\b/.test(lower) ||
      /\bturn\s+off\s+(the\s+)?caveman\b/.test(lower) ||
      /^(please\s+)?(go\s+|back\s+to\s+|switch\s+(back\s+)?to\s+|return\s+to\s+)?normal\s+mode\b/.test(lower) ||
      (/\bnormal\s+mode\b/.test(lower) && /\bcaveman\b/.test(lower));

    const isQuestion =
      /^(what|whats|what's|how|why|when|where|who|does|do|did|is|are|can|could|would|should|tell me|explain)\b/.test(lower);

    const wantsOn =
      /\b(activate|enable|start|turn on|use|switch to|want|give me)\b[^.]{0,40}\bcaveman\b/.test(lower) ||
      /\btalk like\b[^.]{0,40}\bcaveman\b/.test(lower) ||
      /\bcaveman\s+mode\s+(on|please|now)\b/.test(lower) ||
      /^caveman(\s+mode)?\s*[.!]*$/.test(lower) ||
      /\b(less tokens|fewer tokens|be brief|be terse|shorter answers)\b(?!\s+(in|for|on|about|when|during|with)\b)/.test(lower);

    const pluginOwns =
      (lower.startsWith('/caveman') && !informational) ||
      wantsOff ||
      (!wantsOff && !isQuestion && wantsOn);
    if (pluginOwns) {
      unlinkQuiet(suspendPath);
      return;
    }

    const suspended = readSuspend();

    // 2. Manual suspend controls, above all heuristics.
    if (/\bresume caveman\b/.test(lower)) {
      if (suspended) unsuspend(suspended.mode);
      return;
    }
    if (/\b(pause|suspend) caveman\b/.test(lower)) {
      if (suspended) {
        suspend(suspended.mode, true); // upgrade a heuristic suspension to manual
      } else {
        const mode = readMode();
        if (!mode || INDEPENDENT_MODES.has(mode)) return;
        suspend(mode, true);
      }
      emit(SUSPEND_CONTEXT);
      return;
    }

    // 3. Sticky state machine. A manual suspension ignores the RESUME heuristic
    //    entirely — the user named the state, only the user un-names it.
    if (suspended) {
      if (!suspended.manual && matchesAny(RESUME, lower) && !matchesAny(ENTER, lower)) {
        unsuspend(suspended.mode);
        return;
      }
      unlinkQuiet(flagPath); // self-heal if the flag reappeared alongside a suspension
      emit(SUSPEND_CONTEXT);
      return;
    }

    const mode = readMode();
    if (!mode || INDEPENDENT_MODES.has(mode)) return; // caveman not active — nothing to suspend

    if (matchesAny(ENTER, lower)) {
      suspend(mode);
      emit(SUSPEND_CONTEXT);
    }
  } catch (e) {
    /* silent fail — never block a prompt */
  }
});
