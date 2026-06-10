#!/usr/bin/env node
// Memory-reliability nudge — UserPromptSubmit hook.
//
// When the user's message carries an explicit durable-fact signal, inject a
// one-line reminder so the model considers persisting it via the `remember`
// skill. It does NOT force a write — it raises salience; the model's judgment
// still gates what actually gets saved. This closes the "I forgot to call
// remember" gap for the high-value explicit-intent cases (preferences,
// corrections, standing instructions). Implicit facts with no signal word are
// out of scope here (that's the session-sweep's job).
//
// Standalone ESM (hooks/package.json is "type": "module"). No shared-lib
// import → fast startup, since this runs on every prompt.
//
// Registered (UserPromptSubmit) in ~/.claude/settings.json.

// Durable-fact signals. Tuned for recall — a false positive costs ~nothing
// (model reads one line, judges "not durable", moves on), so we err toward
// catching more. Grouped by intent.
const SIGNALS = [
  // explicit memory intent
  /\bremember (that|to|this|my|i\b|we\b|the|how)\b/i,
  /\bkeep in mind\b/i,
  /\bfor (future|next time|the future|later) reference\b/i,
  /\b(from now on|going forward|in (the )?future|henceforth)\b/i,
  /\bdon'?t forget\b/i,
  // standing instructions / config
  /\b(whenever|each time|every time|any time) (i|you|we)\b/i,
  /\bby default\b/i,
  /\bmake sure (to|you) (always|never)\b/i,
  // preferences
  /\bi (prefer|always|never|usually|tend to|like to|want you to|need you to|expect you to)\b/i,
  /\bmy (preference|setup|config|workflow|convention|default|policy|main|usual)\b/i,
  /\byou should (always|never)\b/i,
  /\bplease (always|never)\b/i,
  // corrections
  /\b(no,? actually|that'?s (wrong|incorrect|not right)|correction:)\b/i,
  /\bnot .{1,40} but (rather|instead)\b/i,
  /\b(stop|don'?t) .{1,40} again\b/i,
  // facts to note
  /\b(note that|fyi|just so you know|for the record|heads[- ]up)\b/i,
];

let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  try {
    // Skip in non-iwe sessions — native auto-memory handles persistence there,
    // and the `remember` skill no-ops. Fail open: emit when CC_MEM is map/primer
    // OR unset (better to nudge than silently miss).
    const mem = process.env.CC_MEM;
    if (mem && mem !== "map" && mem !== "primer") return;

    const data = JSON.parse(raw);
    const prompt = (data.prompt || "").toString();
    if (!prompt.trim() || prompt.startsWith("/")) return; // skip empty / slash commands

    if (!SIGNALS.some((re) => re.test(prompt))) return;

    const additionalContext =
      "<memory-nudge> This message may state a durable fact / preference / " +
      "correction worth persisting across sessions (a memory signal matched). " +
      "After answering, judge whether to save it via the `remember` skill — " +
      "skip if transient, already stored, or derivable from code/git. </memory-nudge>";

    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext },
      })
    );
  } catch {
    // Silent — never block a prompt because the nudge failed.
  }
});
