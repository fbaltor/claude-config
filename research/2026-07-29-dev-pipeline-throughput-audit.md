# dev-pipeline throughput audit — scribe, 2026-07-28/29

Measured audit of the three scribe dev sessions of 2026-07-29, evaluated against
`~/.claude/skills/dev-pipeline/README.md`, plus a survey of how the field handles the same
problem. Trigger: "I find the full pipeline kinda slow, considering the complexity/size of
changes."

Method: parsed the raw session transcripts (`~/.claude/projects/**/*.jsonl` + their
`subagents/agent-*.jsonl`) for per-turn timestamps, per-turn token usage, model, effort,
and thinking-vs-text block sizes; cross-referenced against `git log` commit times and
`git diff --stat`. Everything in Part 1 is **[verified]** from those files unless labelled
otherwise. Analysis scripts:
`/tmp/claude-1000/-home-fbaltor/2b88bbac-1aea-4905-b576-4f856776aa27/scratchpad/analyze{,2}.py`.

## Part 1 — What actually happened

### The three sessions

| # | Session | cwd | Span (local) | Wall | Dispatches | Output tok | Delivered |
|---|---|---|---|---|---|---|---|
| A | `be3fffbc` | `~/scribe-main` | 13:33–14:52 | 78 min | **0** | 66,751 | 0 lines |
| B | `3a155a5b` | `~/scribe` (main) | 07-28 15:42 → 07-29 16:51 | 1509 min | 11 | 758,967 (07-29) | 1,831 lines |
| C | `e417c578` | worktree `feat-transcribe-single-file` | 16:11–17:12+ | 61 min | 11 | 274,319 | 396 lines |

(Two other transcripts touched today — `b1a5e9d5`, `b81b28be`, 13 lines each — are scribe's
own `summarize` stage shelling out to the Claude Code CLI, not dev sessions.)

**Session A is not a pipeline run at all.** It is 78 minutes of git-worktree and `mise trust`
friction from a worktree created the wrong way (`~/scribe-main`), with no subagent, no plan,
and no delivered line. The user's own prompts carry the signal: *"why did you make the change
in git (I confess I do not quite get it)?"*, *"please explain in less words..."*, *"no, that
was not necessary..."*, and the worry *"this can cause problems to the other agent running
speaker-diarization-cpu-eval?"*. Any honest accounting of "the pipeline felt slow today" must
put this session in the *environment* column, not the pipeline column — but it did consume
26% of the day's session wall-clock.

### Where the wall-clock went

Inside the pipeline the numbers are not actually alarming. Diarize, 07-29, from research-doc
commit to merged main:

| Time | Event | Δ |
|---|---|---|
| 12:51 | `docs(research)` committed | — |
| 12:52 → 13:08 | test-writer → red-phase suite (653 lines) | 16 min |
| 13:09 → 13:22 | coverage audit → six gaps closed | 13 min |
| 13:25 → 13:43 | re-audit → implementer → `feat(diarize)` (462 lines) | 18 min |
| 13:45 → 14:56 | critic gate + phases 2–4 (e2e, mise, CLI, README, AGENTS.md) | 71 min |

**125 minutes for 1,831 insertions**, including a 456-line module, 921 lines of tests, CLI
wiring and docs. Single-file mode: **56 minutes for 396 insertions** (16:15 plan → 17:11 e2e
commit). Per-stage that is roughly two hours for a substantial stage and one hour for a small
one. The *elapsed* feeling of slowness comes from elsewhere: a 1,025-minute overnight gap
mid-feature, the 78-minute session-A detour, and human idle gaps of 20–40 minutes between
`proceed`s.

### The token economics

| | Session B (07-29) | Session C | A | **Today** |
|---|---|---|---|---|
| Output tokens | 758,967 | 274,319 | 66,751 | **1,100,037** |
| Cache creation | 8,845,056 | 2,289,206 | 98,963 | **11,233,225** |
| Cache read | 109,036,670 | 21,770,700 | 2,406,228 | **133,213,598** |

2,227 delivered lines → **494 output tokens per delivered line** and **59,818 cache-read
tokens per delivered line**. A line of Python is ~10–12 tokens, so the pipeline emits roughly
40–50× the artifact in model output. The two features agree closely on this ratio (B: 415
tok/line, C: 693 tok/line), which means it is a property of the *pipeline*, not of one bad run.

### Why it is slow — the decomposition

Per-turn throughput is **fine**, and Fable is not the culprit:

| Scope | Model | n | Median turn | tok/s |
|---|---|---|---|---|
| B orchestrator | fable-5 | 346 | 4.8 s | 176.7 |
| C orchestrator | fable-5 | 88 | 1.3 s | 185.4 |
| C orchestrator | opus-5 | 65 | 3.1 s | 116.9 |
| B subagents | fable-5 | 699 | 1.6 s | 87.6 |

Fable ran *faster* per token than Opus in this data. So the wall-clock is **turns × tokens per
turn**, not tokens per second. Session B on 07-29 alone ran **633 model turns** at a mean gap
of 9.4 s ≈ 99 minutes of pure model time. To go faster you must generate fewer tokens or take
fewer turns. Three multiplicative amplifiers were active, all of them configuration:

1. **`CLAUDE_CODE_EFFORT_LEVEL: "xhigh"` in `~/.claude/settings.json` `env`** — global, so it
   applied to the orchestrator *and* every subagent. Verified: all 11 subagents in B and all
   real subagents in C ran `effort=xhigh`, the second-highest of five levels. That includes the
   read-only coverage-verifier (a classification task) and the README writer.
2. **`alwaysThinkingEnabled: true`** — thinking on every turn. Measured thinking share of all
   generated characters: **B orchestrator 65.5%, B subagents 69.0%, C orchestrator 82.5%**.
   Per role, the planner is the extreme: **89.6% thinking** (46,598 chars of reasoning to emit
   5,396 chars of plan text); test-writer 81.0%; implementer 72.7%. Roughly two-thirds of
   everything paid for today was reasoning, not artifact.
3. **`autoCompactEnabled: false`** with long-lived sessions — context grows monotonically.
   Session B, 07-29: context per turn median **137,499**, mean **186,227**, p90 **381,771**,
   max **432,603**; **42% of turns ran above 150k**. That is what produces 133M cache-read
   tokens, and prompt length drives time-to-first-token even when cached.

The session model was `claude-fable-5` for all three sessions (the residue of an earlier
`/model` choice; the user switched to Opus at 16:46, near the end of the day). Per
`tooling/cc-model-tiering`, Fable left subscription plans on 2026-07-12 and is API-only at
$10/$50 per MTok. **[assumed, needs `/status` + console check]** if today's Fable traffic
billed against an API key, the day's cost is on the order of **$300** (≈$55 output, ≈$140
cache creation, ≈$133 cache read). If it billed against the subscription, ignore that figure.
Either way the *intended* tiering inverted: the design pins the planner **up** to Fable and
lets everything else inherit — with a Fable session, "everything else" became Fable too, so
the most expensive model ran the cheapest roles. **The tiering has a ceiling and no floor.**

### Two incidents worth recording

**Five dispatches died on `API Error: 529 Overloaded`** in session C (two test-writer, two
README, one critic), consuming ~15 of that session's 61 minutes in retry sequencing. Each
retry re-pays the full brief; no partial work survives, because a fresh agent starts clean.

**The critic gate was silently downgraded.** The final retry of "Critic review of docs and e2e
phases" was dispatched with an explicit `model: sonnet` override — verified in the tool_use
input; it was the only dispatch all day carrying a model parameter. Sonnet is *less* capable
than the session's Opus, and `CLAUDE.md` §Model Tiering says fallback goes to the next **more**
capable model, never a less-capable one. So an overload was worked around by weakening the one
role whose entire purpose is adversarial rigour, and nothing in the pipeline would have
reported that.

## Part 2 — Evaluation against the dev-pipeline design

### What earned its cost

The gates are not ceremony. They caught real defects, with evidence:

- **coverage-verifier** found that the transcript.json marker assertion was satisfied by *any*
  ≥3-char string leaf — "a marker omitting model identifiers passes". That produced commit
  `27f1143`, "close six coverage-audit gaps in the red-phase suite".
- **critic** found a plan self-contradiction (the empty-merges bullet asserting byte-identical
  *transcript files* where only the `.txt` can be), a **torn-write window** across three
  output files (fixed with tempfile + `os.replace` and an explicit write order), and
  `manual-acceptance-breaks-in-worktree` (relative paths that fail outside the main checkout).
- In session C the critic drove `a2d7a50` + `a72c29f` — a genuine input-collision bug where a
  transcript-stem filename collides with the merged artifact names.

Input partitioning held: the test-writer never received implementation notes, the implementer
never edited a test file, and the evidence discipline (paste raw output, label
`[verified]`/`[assumed]`) is visibly present in every subagent report. `tooling/dev-pipeline-red-phase-limits`
documents why the implementer's no-edit rule is load-bearing; that rule was respected.

### What cost more than it returned

**Plan documents are larger than the code they describe.** Diarize plan: 727 lines → 456
production lines. Reconcile plan: 754 lines → 0 lines so far. Single-file: 245 lines → 117
changed lines. The planner spends ~90% of its tokens thinking to produce them, and then every
downstream role reads them. A 754-line plan is a context tax paid on every subsequent turn.

**Critic-on-plan is a de facto stage that the spec does not define.** The README's step 2 is
*user* plan review; the critic gate (step 4) is per-phase, on artifacts. But in practice the
user asked *"trigger an adversarial reviewer of the plan"* at 18:55 on 07-28, then asked *"why
this wasnt triggered automatically?"*, and asked again at 16:44 on 07-29. That stage then ran
as a **7-segment SendMessage ping-pong** over three hours (22.8 min active, 92,085 output
tokens, 37 Bash calls) closing findings A1–A4 one at a time on a *document*. It is the single
most expensive role of the day — more than the implementer in both time and tokens — and it is
unspecified, so it is neither budgeted nor bounded.

**The re-audit loop doubles a cheap stage.** Coverage-verifier ran twice (1.1 min + 5.0 min);
the second pass is pure re-read. Correct per the spec, but at xhigh effort on Fable.

**Uniform rigour, uniform cost.** The test-rigor tier table (`light`/`standard`/`exhaustive`)
is the one place the pipeline can say "less". It governs *test depth only* — there is no
equivalent dial for effort, model, plan length, or how many gates a phase gets. So a docs
phase and a core-module phase both got xhigh reasoning on the most expensive model.

**Strictly serial, by construction, and never batched.** Verified: **all 11 dispatches in
session B were one-per-assistant-message** — even the three research agents, sent at 19:10:14,
19:10:28, 19:10:46 as three separate messages. They overlapped in wall-clock only because they
were background. The code path (test-writer → coverage → implementer → critic) is inherently
serial, which is the price of TDD; but 9 of 11 dispatches in C were `run_in_background: false`,
so the orchestrator blocked on each. This matches the standing finding in
`preferences/ai-dev-cadence`: parallel fan-out is still near zero, and throughput stays capped
at reaction speed.

**No cost or latency budget exists anywhere in the pipeline spec.** The README has a rigor tier,
cycle caps (2 test cycles, 2 critic cycles), and an escalation rule — all *quality* governors.
Nothing in it can ever say "this phase is spending too much." The critic even has a mandated
tier line to flag an *oversized test suite* as a FAIL, which proves the design already accepts
"too much is a defect" — that principle is simply not extended to effort, model, or plan size.

### Fair verdict

The pipeline's *quality* machinery is working and worth keeping. Its *throughput* problem is
overwhelmingly configuration, not architecture: one `env` line applying maximum-but-one
reasoning to every role, plus always-thinking, plus no compaction on long sessions, plus a
session model that collapsed the intended two-tier split into one expensive tier. Those are
lines in `settings.json` and a few lines in the agent frontmatter — not a redesign.

## Part 3 — How the field handles this

### The core tension is genuine and unresolved

Anthropic's own multi-agent research system reports **~90.2% improvement over single-agent
Opus 4 at roughly 15× the tokens** of a normal chat, with token usage explaining ~80% of
performance variance — and their stated spawn criterion is narrow: spawn a subagent when the
work needs a *different context, different tools, or a different system prompt*; if a subtask
shares the parent's context, **a longer prompt or an extra tool call is cheaper and more
reliable**. Cognition argues the opposite pole in *Don't Build Multi-Agents*: single-threaded,
continuous context, with a dedicated compression model for long tasks, because dispersed
decision-making makes multi-agent systems fragile. The 2026 middle ground is the
orchestrator + **ephemeral** subagent pattern: one agent owns the context, spawns isolated
subagents that return a single summary string, no peer-to-peer channel, no shared mutable
state — which is structurally what dev-pipeline already does.

Independent measurements of the overhead: three-agent settings typically incur **3–6× slowdown**
versus single-agent, with some models near 10×; the cost driver is repeated context retrieval
and each agent needing prior agents' outputs. Augment's framing is "why 3 agents cost 10x",
and they warn the 15× baseline compounds without circuit breakers or per-run caps.

### The remedy families

**1. Effort as the primary dial, defaulted low and escalated on signal.** The strongest and
cheapest lever, and it maps directly onto the finding above. Guidance is explicit that applying
high/max effort to straightforward tasks "produces identical results to lower levels while
wasting tokens and increasing latency"; medium is the recommended default for agentic coding
and test writing; low is for renames, formatting, boilerplate. Costs scale non-linearly —
medium→high is a bigger jump than low→medium, and max can consume 10×. The production pattern
is: **default low, escalate the single request on signal** (low confidence, validation failure,
unresolved tool), rather than defaulting high. One study shows success rising 24.3%→32.5% as
thinking budget goes 256→8192 tokens while inference time rises 6.5 s→19 s — real gains, but
bought at ~3× latency, which is exactly the trade you want to make deliberately per role.

**2. Model routing per role.** The adversarial-code-review pattern routes **Builder → high
throughput** and **Critic → high reasoning**, explicitly different tiers for different roles.
This is the "floor" that dev-pipeline lacks: it pins the planner up but never pins the
mechanical roles down.

**3. Quality-gated granularity control.** *Agent Capsules* (arXiv 2605.00410) targets exactly
the over-decomposition failure: adaptive controllers measure whether running a separate agent
buys enough quality to justify its tokens, and **merge stages when the gain falls below a cost
threshold**. That is the missing governor — the formal version of "this phase doesn't need five
roles."

**4. Scope the critic's context, don't hand it everything.** "Content gates" give the critic
only *changed files plus the relevant spec sections*, never the full diff or the full plan. When
multiple critics run, a **moderator** deduplicates findings to avoid alert fatigue and
conflicting directives. Fresh sessions are required specifically so the critic doesn't
re-process the builder's reasoning — which dev-pipeline already enforces via cold review.

**5. Push negation-heavy checks to deterministic gates.** LLMs "are statistically predisposed
to underweight negation", making `DO NOT` constraints the weakest link in probabilistic review.
Lint, typecheck and compile should own those, not the critic. scribe already has `mise run lint`
/ `typecheck` — every constraint moved there is a constraint the critic no longer has to spend
xhigh reasoning on.

**6. Filesystem handoff instead of funnelling through the lead.** Anthropic's system has
subagents write outputs **directly to the filesystem** rather than returning everything through
the lead agent, to avoid token bloat; and when hitting limits, spawn a fresh subagent with a
clean context plus a handoff. dev-pipeline does this for plans (the planner returns a *path*)
but not for critic/coverage reports, which come back inline.

**7. Compression as an explicit role.** Cognition proposes a dedicated model whose only job is
compressing history into key details, events, and decisions. With `autoCompactEnabled: false`
and p90 context at 381k, this is the gap that produced 133M cache reads.

**8. Review gates are measurably cheaper than unbounded loops.** The co-evolved review gate is
reported to consume **1.35×–1.72× fewer tokens** than full multi-turn coding execution loops —
i.e. a well-scoped gate *saves* tokens versus letting an agent iterate blindly. Keeping the
gate is right; the question is only its effort and context.

### The harness landscape

The field is polarised on exactly the axis in question. **BMAD Method** is the heavy pole: 26
specialised persona agents (Analyst, PM, Architect, Scrum Master, PO, Dev, QA), a rigid
Plan → Architect → Implement → Review cycle, each phase in a fresh chat, versioned artifact
handoffs in git — and correspondingly the most complex, with significant upfront learning
investment. **Superpowers** is the deliberate counter-move: it "removed persona overhead for
better performance" and runs across eight harnesses. **Spec Kit** (GitHub) sits between.
`aaddrick/claude-pipeline` packages a portable Claude Code pipeline of skills, agents, hooks and
quality gates — the closest public analogue of dev-pipeline.

The most useful external check on the "too heavy" instinct: Thoughtworks' Technology Radar
Vol. 33 puts spec-driven development in **Assess** and names *"a bias toward heavy up-front
specification and big-bang releases"* as an explicit antipattern; the pragmatic recommendation
is **spec-anchored, not spec-as-source** — acceptance criteria in EARS notation, code as source
of truth, tests as enforcer. SDD is judged worth it for complex requirements, multiple
maintainers, integration-heavy or regulated systems, and **not** worth it for throwaway
prototypes, solo short-lived work, or exploration where requirements are still unknown. A
727-line plan for a 456-line module in a solo repo is precisely the "big-bang specification"
shape the Radar flags. There is a parallel finding on instruction files: frontier models
reliably follow on the order of **150–200 standing instructions** before compliance degrades,
so an everything-included agent file is "a failure mode wearing a diligence costume."

### The honest counterweight

METR's RCT is the standing reminder that felt speed and measured speed diverge: 16 experienced
open-source developers on 246 real tasks in repos they knew well were **19% slower** with AI
access, while forecasting +24% and self-reporting +20% afterwards — a ~39-point perception gap.
METR now labels the result historical (early-2025 tooling, Cursor Pro with Claude 3.5/3.7). The
methodological lesson survives the caveat: *"the pipeline feels slow"* and *"the pipeline is
slow"* are different claims, and the only way to tell them apart is the kind of measurement in
Part 1. Today's measurement says the perception is well-founded on **cost** (494 output tokens
per delivered line, 133M cache reads) and only partly on **wall-clock** (≈2 h per substantial
stage, with the largest single delays being an overnight gap, a 78-minute environment detour,
and human idle time between `proceed`s).

## Recommendations, cheapest first

Items 1–2 are **implemented** (see the next section); 3–8 are open, for review.

1. ~~**Stop applying `xhigh` globally.**~~ **Done.** Per-role effort instead of one global level.
2. ~~**Give the tiering a floor, not just a ceiling.**~~ **Done.** Mechanical roles pinned down;
   gate downgrades prohibited and made self-disclosing.
3. **Re-enable compaction, or add a compression step for sessions that outlive a feature.**
   p90 context of 381k with 42% of turns above 150k is the direct cause of the cache-read bill.
4. **Budget the plan.** Add a plan-size ceiling proportional to the change (the diarize plan
   was 1.6× its production code). Thoughtworks' spec-anchored framing is the guardrail.
5. **Specify the plan-review stage or delete it.** It ran twice today, both times on the user's
   manual prompt, and became the most expensive role of the day. Either make it a defined,
   bounded stage with a cycle cap, or replace it with the existing user plan review.
6. **Add a cost governor to the critic brief**, mirroring the existing anti-oversized-suite
   tier line: the critic already treats "too much" as a FAIL for tests; extend that to effort
   and plan size.
7. **Bound the 529 blast radius.** Retries currently re-pay the whole brief and, once, silently
   downgraded the gate. Prefer resuming the same agent via `SendMessage` over spawning a fresh
   one, and never let a retry lower a role's model tier.
8. **Fix the worktree ergonomics** that cost 78 minutes in session A — that was the day's
   largest single block of non-productive wall-clock, and it is orthogonal to the pipeline.

## Implemented 2026-07-29 (items 1–2)

Mechanisms verified against `code.claude.com/docs/en/sub-agents` and `/model-config` before
editing, because the fix depends on two precedence facts: subagent frontmatter accepts an
**`effort`** field (`low|medium|high|xhigh|max`) that **overrides the session effort level**, and
`model` accepts `sonnet|opus|haiku|fable|<full-id>|inherit`.

**The env var was removed, not lowered.** The measured problem was framed as "xhigh is too high",
but the more important fact is that **the platform default effort is already `high`** on every
model that supports it. `CLAUDE_CODE_EFFORT_LEVEL` in `settings.json` `env` was therefore doing
two harmful things at once: raising every role to `xhigh`, *and* pinning the level so the user's
`/effort` (or `--effort`) choice was overridden on every new session. Deleting the key restores
the stock `high` default and hands the dial back to the user — so the Opus orchestrator and the
generic agents (`general-purpose`, `claude`, `Explore`, caveman) are **not** downgraded below
stock behaviour; they return to it. An intermediate edit setting the var to `medium` was reverted
for exactly this reason: it would have pushed the orchestrator and every non-declaring subagent
*below* the platform default.

Per-role settings now live in the agent definitions, where they beat the session level:

| Role | `model` | `effort` | Change |
|---|---|---|---|
| planner | `fable` (unchanged) | `high` | was xhigh; 89.6% thinking share, main plan-bloat driver |
| test-writer | `inherit` | `medium` | was xhigh; not lowered further — red-phase expectations are error-prone |
| coverage-verifier | `sonnet` | `medium` | was inherit/xhigh — the one role pinned **down** |
| implementer | `inherit` | `medium` | was xhigh; contract is external, so bounded |
| critic | `inherit` | `high` | was xhigh; keep high, bump only if quality visibly drops |

**Anti-downgrade mechanism.** `critic.md` gained a *Disclose your own tier* rule and a
`review_context` block at the head of its YAML output carrying `model`, `effort`, and a
`tier_warning` when it was dispatched below the session tier. This exists because the failure
mode was invisible: a 529 retry passed `model: sonnet` to the gate and nothing reported it. The
prohibition is stated in `CLAUDE.md` §Model Tiering (retry at the same tier, or resume via
`SendMessage`; fall back *upward* only) and in the pipeline README, with the distinction that
downgrading a *producing* role is fine while downgrading a *checking* role is not.

Files touched: `settings.json`, `CLAUDE.md` (§Model Tiering — added the floor, the
gate-downgrade prohibition, and the effort-is-per-role rule), `skills/dev-pipeline/README.md`
(§Model + effort tiering — new per-role table), and all five
`skills/dev-pipeline/agents/*.md` frontmatter blocks.

**Takes effect** on `/reload-plugins` or a new session — `dev-pipeline` is a skills-directory
plugin, so edits are not live in an already-running session.

**Not measured yet.** The expected saving is inferred from the 65–82% thinking share and the
non-linear effort/cost curve, not observed. The honest next step is to re-run this analysis after
the next comparable feature and compare output-tokens-per-delivered-line against today's
baseline of **494** (session B 415, session C 693). The one regression to watch is the
coverage-verifier on `sonnet`/`medium`: at `fable`/`xhigh` it caught a genuinely subtle gap (an
assertion satisfiable by any ≥3-char string), and that is the single change in this batch with a
real quality risk.

## Part 4 — How to actually measure whether the change helped

Researched 2026-07-29, after the config change, to answer "what would a credible before/after look
like?". **Provenance caveat:** this part was researched inline rather than by the three dedicated
sub-agents originally dispatched, because all three died on repeated `API Error: 529 Overloaded`
(two cycles each, six failures; each was resumed via `SendMessage` at the same tier per the new
guardrail, never respawned cheaper). It is therefore less exhaustive than intended — the Codex,
Aider and eval-framework sections are thinner than the Claude Code one. Gaps are marked.

### The decisive finding: the instrument already exists, natively

Claude Code's OpenTelemetry export carries **exactly** the attribution this question needs.
`CLAUDE_CODE_ENABLE_TELEMETRY=1` plus an exporter (`OTEL_METRICS_EXPORTER`,
`OTEL_EXPORTER_OTLP_ENDPOINT`, …) emits `claude_code.cost.usage` (USD) and
`claude_code.token.usage` (tokens), and **both carry these attributes** [verified,
code.claude.com/docs/en/monitoring-usage]:

- `model` — the model identifier
- `query_source` — `"main"` | `"subagent"` | `"auxiliary"`
- `agent.name` — the subagent type
- `effort` — `"low"` | `"medium"` | `"high"` | `"xhigh"` | `"max"`, absent if unsupported
- and on the token metric, `type` — `"input"` | `"output"` | `"cacheRead"` | `"cacheCreation"`

That is a per-role, per-effort, per-token-type cost breakdown with no custom tooling. The
`claude_code.api_request` event additionally carries `input_tokens`, `output_tokens`,
`cache_read_tokens`, `cache_creation_tokens`, `cost_usd` and `cost_usd_micros`, with `prompt.id`
correlating every event from one user prompt.

**The operational trap that would silently ruin the measurement:** `agent.name` records built-in
names verbatim but **collapses user-defined agents to `"custom"` unless `OTEL_LOG_TOOL_DETAILS=1`**
(and `plugin.name` collapses third-party to `"third-party"` the same way). Every dev-pipeline role
is plugin-defined, so without that flag all five roles report as one indistinguishable `"custom"`
bucket — the exact dimension being tested. Set it, or the data cannot answer the question.

Other metrics available: `claude_code.session.count`, `claude_code.lines_of_code.count`,
`claude_code.commit.count`, `claude_code.pull_request.count`, `claude_code.active_time.total`,
`claude_code.code_edit_tool.decision`. Note that `lines_of_code.count` and `commit.count` together
give the *denominator* of the tokens-per-delivered-line metric automatically.

### The transcript route is the only one that can see the past

Telemetry only starts collecting when enabled, so it cannot produce the *before* half of a
before/after. The transcript corpus can: **1,955 JSONL files, 639 MB** already on this machine
[verified locally], including per-subagent transcripts under `<session>/subagents/`. Every
assistant message carries a `usage` object with `input_tokens`, `output_tokens`,
`cache_creation_input_tokens`, `cache_read_input_tokens`, plus `model`, `effort` and timestamps —
which is how every number in Part 1 was derived. Community tools over the same data:
**ccusage** (~4,800★, offline, daily/monthly/per-session, tracks cache tokens separately),
**CodeBurn** (classifies each turn into 13 categories by tool-usage pattern), **cccost/ccost**
(per-request costing via LiteLLM pricing data). [assumed] None of them was confirmed to attribute
cost to *subagent type* — the `analyze2.py` scripts written for this audit do, so keep them.

### Gateway-level accounting: capable, but inapplicable here

The standard production stack is **LiteLLM proxy** for routing plus **Langfuse** or **Helicone**
for tracing: every request through the proxy logs input tokens, output tokens, per-request cost
and latency, segmentable via `Helicone-User-Id` / `Helicone-Property-*` headers or custom session
IDs (agent traces otherwise appear as a flat sequence of LLM calls, losing the agent-graph view).
**But this does not apply to a subscription setup:** per `tooling/cc-model-tiering`, Claude Code
cannot mix billing sources within a session and `ANTHROPIC_API_KEY` outranks subscription OAuth,
so routing through a gateway flips the whole session to API billing. Rejected on that ground, not
on capability.

### Cross-tool comparison (thin — the dedicated agent never ran)

**OpenAI Codex** is the closest analogue and configures the same dial: `model_reasoning_effort`
accepting `minimal|low|medium|high|xhigh` (model-dependent), with OTel settings under an `[otel]`
section in `~/.codex/config.toml` (`exporter`, `metrics_exporter`, `trace_exporter`,
`log_user_prompt`). Its metrics centre on `tokens.used` per session segmented by model, with
default tags `auth_mode`, `originator`, `session_source`, `model`, `app.version`. **Claude Code's
telemetry is materially richer for this specific question**, because Codex's documented tags
include no effort or per-subagent attribution. One practitioner claim worth noting as
corroboration of the effort/cost curve, though blog-level not primary: high reasoning effort
"costs 3-5x more tokens". **Not covered** (agents died): Aider's inline per-message cost accounting
and polyglot benchmark, Gemini CLI, opencode/Amp/Cline/Goose/Copilot CLI.

### The methodology, and why n=2 cannot work

Agents are non-deterministic on identical input: one study reports **2.3–4.2 distinct action
sequences per 10 runs** on the same inputs, and the standard guidance is to average **3+ runs**,
measuring baseline noise across three *identical* runs first and setting any quality gate above
that noise floor. A sharp warning from the same literature: two runs of the same agent on the same
task set can produce nearly identical *aggregate* scores while disagreeing on a meaningful
fraction of *individual* tasks — aggregate stability hides task-level noise.

**Your own data already measures the noise floor, and it is large.** The two features on
2026-07-29 ran under an *identical* configuration (Fable, `xhigh`, always-thinking) and still came
out at **415 vs 693 output tokens per delivered line** — a 67% spread with the config held
constant. Task difficulty and shape alone move this metric by two-thirds. So a single
before/after feature pair cannot detect any config effect smaller than roughly that, and the
honest conclusion is that **the next feature's number will be uninterpretable on its own.** What
is interpretable: the mechanism-level metrics that don't depend on task size — thinking-token
share per role (65–82% before), effort attribute values, and context-per-turn — because those
move directly with the setting rather than with the work.

Anthropic's own eval guidance fits a solo setup: **"20-50 simple tasks drawn from real failures is
a great start"**, each unambiguous enough that two domain experts reach the same pass/fail verdict,
sourced from "the manual checks you run during development"; and they explicitly track efficiency
alongside correctness — turn count, tool calls, total tokens, time-to-first-token, output
tokens/second, time-to-last-token. They also stress **reading transcripts** to confirm a score
change reflects agent behaviour rather than an eval artifact. They do not prescribe a sample count,
and do not directly address comparing two *harness configurations* rather than two models —
that gap appears to be genuinely unaddressed in primary sources.

### Recommended protocol, sized to be doable

1. **Enable OTel now, with `OTEL_LOG_TOOL_DETAILS=1`.** One-time setup; gives per-role,
   per-effort cost and token attribution for all future work. This is the single highest-value
   step and it is nearly free.
2. **Do not try to A/B on real features.** The 67% same-config spread makes it futile. Judge the
   change on the mechanism metrics instead (thinking share, effort attribution, context per turn),
   which are directly attributable.
3. **If you want a real answer, build a small fixed task set** — 5–10 replayable tasks from scribe's
   own history, not 20–50, since each costs a full pipeline run — and run it **A/A first** (same
   config three times) to see the noise floor before comparing configs at all.
4. **Track the gate-catch rate** (real defects the critic finds per phase) as the quality guard on
   the cost cuts. It is the metric that would catch the coverage-verifier downgrade, and today's
   audit gives concrete precedents to compare against.

## Sources

Field research, 2026-07-29.

- [Don't Build Multi-Agents — Cognition](https://cognition.com/blog/dont-build-multi-agents)
- [How Anthropic Built a Multi-Agent Research System — ByteByteGo](https://blog.bytebytego.com/p/how-anthropic-built-a-multi-agent)
- [Multi-Agent Cost Compounding: Why 3 Agents Cost 10x — Augment Code](https://www.augmentcode.com/guides/multi-agent-cost-compounding)
- [Agent Capsules: Quality-Gated Granularity Control for Multi-Agent LLM Pipelines — arXiv 2605.00410](https://arxiv.org/pdf/2605.00410)
- [Claude Code Effort Levels Explained — MindStudio](https://www.mindstudio.ai/blog/claude-code-effort-levels-explained)
- [Reasoning effort: cut LLM cost and latency in production — Boundev](https://www.boundev.ai/blog/reasoning-effort-llm-cost-latency)
- [Adaptive Reasoning Depth in AI Agent Systems — Zylos Research](https://zylos.ai/research/2026-04-13-adaptive-reasoning-depth-ai-agent-systems/)
- [Adversarial Code Review — ASDLC.io](https://asdlc.io/patterns/adversarial-code-review/)
- [A Subgoal-driven Framework for Improving Long-Horizon LLM Agents — arXiv 2603.19685](https://arxiv.org/pdf/2603.19685)
- [1-2-3 Check: multi-agent latency overhead — arXiv 2508.07667](https://arxiv.org/pdf/2508.07667)
- [Measuring the Impact of Early-2025 AI on Experienced Open-Source Developer Productivity — METR](https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/)
- [Spec-Driven Development in 2026 — DEV](https://dev.to/krlz/spec-driven-development-in-2026-what-it-is-the-tooling-and-how-teams-actually-use-it-2fk2)
- [Spec-Driven Development with AI Coding Agents (2026) — zeroshot](https://zeroshot.ghost.io/spec-driven-development-with-ai-coding-agents/)
- [Spec-driven development — Thoughtworks](https://thoughtworks.medium.com/spec-driven-development-d85995a81387)
- [Choosing Your AI Coding Framework — Spec Kit vs. BMAD vs. Claude Code](https://pradeepbatchu.medium.com/choosing-your-ai-coding-framework-spec-kit-vs-bmad-vs-claude-code-1a8fa261a751)
- [Agentic Skills Frameworks Compared — Ry Walker](https://rywalker.com/research/agentic-skills-frameworks)
- [aaddrick/claude-pipeline — GitHub](https://github.com/aaddrick/claude-pipeline)
- [Codex Subagents GA — digitalapplied](https://www.digitalapplied.com/blog/codex-subagents-ga-multi-agent-autonomous-coding-guide)

Part 4 (measurement) sources:

- [Claude Code — Monitoring usage (OTel metrics, events, attributes)](https://code.claude.com/docs/en/monitoring-usage) — primary; the metric/event/attribute identifiers
- [Claude Code — Create custom subagents (frontmatter `effort`, `model`)](https://code.claude.com/docs/en/sub-agents) — primary
- [Claude Code — Model configuration (effort levels, defaults, `/effort`)](https://code.claude.com/docs/en/model-config) — primary
- [Demystifying evals for AI agents — Anthropic](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) — primary; 20-50 tasks, efficiency metrics
- [ccusage — usage analysis over Claude Code JSONL](https://ccusage.com/guide/cost-modes)
- [badlogic/cccost — instrument Claude Code for actual token usage and cost](https://github.com/badlogic/cccost)
- [CodeBurn — analyze Claude Code token usage by task (HN)](https://news.ycombinator.com/item?id=47759035)
- [Codex CLI observability: OpenTelemetry traces and metrics](https://codex.danielvaughan.com/2026/03/28/codex-cli-opentelemetry-observability/)
- [openai/codex — Observability and Telemetry (DeepWiki)](https://deepwiki.com/openai/codex/9.4-observability-and-telemetry)
- [Codex advanced configuration (`model_reasoning_effort`)](https://developers.openai.com/codex/config-advanced)
- [Langfuse — observability for LiteLLM proxy](https://langfuse.com/integrations/gateways/litellm)
- [LiteLLM vs Helicone vs Langfuse (2026)](https://llmcfo.com/research/litellm-vs-helicone-vs-langfuse)
- [When Agents Disagree With Themselves — arXiv 2602.11619](https://arxiv.org/html/2602.11619v2) — run-to-run action-sequence variance
- [The Non-Determinism Problem: evaluating agents reliably — The Context Lab](https://www.thecontextlab.ai/blog/non-determinism-problem-evaluating-agents-reliably)
- [Testing AI Agents: validating non-deterministic behavior — SitePoint](https://www.sitepoint.com/testing-ai-agents-deterministic-evaluation-in-a-non-deterministic-world/)
- [Choosing the Right Multi-Agent Architecture — LangChain](https://www.langchain.com/blog/choosing-the-right-multi-agent-architecture)

Local ground truth: session transcripts under `~/.claude/projects/-home-fbaltor-scribe*/`;
`~/scribe` git history `9db2d9a..7da1a15` and `7da1a15..97f891d`; `~/.claude/settings.json`;
`~/.claude/skills/dev-pipeline/README.md`. Related memory:
`tooling/cc-model-tiering`, `tooling/dev-pipeline-red-phase-limits`,
`preferences/ai-dev-cadence`, `agentic-engineering/patterns`.
