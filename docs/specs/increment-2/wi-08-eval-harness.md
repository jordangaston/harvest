# WI-08 — The golden-transcript eval harness

## Background

Multi-party goal-tracking has no published eval for Harvest's exact combination (Q-2-2), so the
design names the golden-transcript harness as the key test infrastructure of increment 2
(`docs/imessage-onboarding/increment-2-reasoning-and-onboarding.md`, "Testing → Integration"). The
chef is two LLM loops writing through validated tools; the risk is not that a single call is wrong
but that a *conversation* — a correction, a proxy answer, a conflict — drives the wrong tool calls
or the wrong final DB state. Unit tests (WI-01/04/05) cover pure logic; this harness covers the
conversation.

The harness replays a **scenario file** against the **real prompt + real tools + a seeded `file:`
db + a SCRIPTED model + a stub Spectrum sender**. Because the model is scripted (a deterministic
tool-call sequence per turn), the replay is offline and deterministic, and assertions are on
**tool-call sequences and final DB state — never exact wording**. A separate **rubric judge** (a
real LLM) samples transcripts for voice and the fidelity rule; that part needs a real model, so it
is gated out of the fast offline suite.

Scenario coverage from the design: the `02` reference onboarding script; a **correction**
("actually make that 5–6"); a **proxy answer** ("his name is Sam and he's vegetarian too", said by
Priya); a **conflict**. These exercise the parser-is-the-LLM behavior and the idempotent
read-merge-write invariant.

## Objective

Build a scenario-replay harness so that:

1. A scenario file (turns of inbound messages, each with the sender's handle and a scripted model
   response) replays deterministically against the real onboarding objective, real tools, and a
   seeded `file:` db.
2. The harness asserts the **expected tool-call sequence** for each turn and the **resulting rows**
   (`households`, `household_members`, `household_preferences`, `slots`) after the replay — not
   wording.
3. A **proxy-answer** scenario attributes facts to the *named* member, not the speaker.
4. A **correction** scenario re-writes idempotently (the second value replaces the first; no
   duplicate row, no corruption).
5. The rubric judge (real model, gated) samples a transcript for voice + the fidelity rule.

Offline vs gated is explicit: the scripted-model tool/DB assertions run in the fast offline suite;
the rubric judge runs only under the gated e2e/tagged suite.

## Scope

| In scope | Out |
|---|---|
| Scenario file format + loader | Live iMessage / real Spectrum (that is the manual acceptance test) |
| A `ScriptedModel` that returns a fixed tool-call sequence per turn | Fuzzing / generated scenarios |
| Replay driver: seed db → run each turn through the real Chef path with the scripted model → assert tool calls + DB | Perf/latency assertions |
| The 4 named scenarios: reference script, correction, proxy answer, conflict | Non-onboarding objectives (increment 3) |
| The gated rubric judge over sampled transcripts | Rubric-judge scoring thresholds tuning (record, don't gate CI on the score) |

## Design

### Scenario file

A scenario is a declarative file (TS or JSON under `test/eval/scenarios/`) — the reference script
is `reference-onboarding`; the variants are `correction`, `proxy-answer`, `conflict`.

```ts
type Scenario = {
  name: string;
  seed?: SeedSpec;                 // optional pre-existing rows (e.g. a legacy user for migration)
  turns: ScenarioTurn[];
};

type ScenarioTurn = {
  inbound: { handle: string; body: string };  // who texted and what
  model: ScriptedTurn;                          // the deterministic model output for this turn
  expectToolCalls: ToolCallMatcher[];           // ordered tool calls this turn must make
};

type ScriptedTurn = {
  // The reasoning model's scripted output: the tool calls (in order) + the ReplyPlan it yields.
  toolCalls: Array<{ name: string; args: Record<string, unknown> }>;
  replyPlan: ReplyPlan;
  // The response model's scripted output for this turn (bubbles/tapbacks) — wording is irrelevant
  // to assertions but present so the transcript is judgeable.
  chatEvents: ChatEvent[];
};

type ToolCallMatcher = { name: string; argsSubset: Record<string, unknown> };
```

[ASSUMPTION: the reasoning/response agents (WI-04/05) are Mastra `Agent`s whose model is injectable
(constructor/runtime-context param), so the harness passes a scripted model instead of DeepSeek. If
WI-04/05 do not expose a model seam, WI-08 adds a minimal one — a `model` dependency on the agent
factory — as part of this WI; the scripted model implements the same call interface the agent
expects and returns `ScriptedTurn.toolCalls` then `replyPlan`/`chatEvents` in order.]

### ScriptedModel

A deterministic double for the model: it holds a queue of `ScriptedTurn`s keyed by turn index and,
when the agent "generates", it emits that turn's tool calls (so the real tool `execute` runs — real
`canRun`, real Zod, real in-process service write to the seeded db), then the scripted `replyPlan`.
The response agent's scripted model returns the turn's `chatEvents`. No network. It records the
actual tool calls the agent made so the harness can assert the sequence.

### Replay driver

For each scenario: `migratedFileDb()` → apply `seed` → for each turn, insert the inbound message
(as the webhook would), run `chef.respond(threadId)` with the scripted model wired in through
`selectChef`-style injection and a stub sender, then assert `expectToolCalls` against the recorded
calls. After the last turn, assert final DB state against the scenario's expected rows.

### The gated rubric judge

A separate suite (`vitest.e2e.config.ts` or a `@rubric` tag) that, for one or two sampled scenario
transcripts, calls a **real** LLM as a judge with a rubric: (a) voice matches the chef persona,
(b) the fidelity rule holds — every `must_say` surfaced, no fact added/dropped/softened. It records
the judgment; it does not gate the fast suite. It is skipped when no model key is present.

## Acceptance Criteria

**AC-1 — a scenario replays deterministically.** Running `reference-onboarding` twice produces
identical recorded tool-call sequences and identical final DB rows; no network is touched (offline).

**AC-2 — the harness asserts tool calls + resulting rows.** For `reference-onboarding`, the harness
verifies each turn's ordered tool calls (`save_household_profile`, `save_member_profile`,
`search_catalog`) match `expectToolCalls`, and after replay the `households` (1 row, owner set),
`household_members` (one per participant), `household_preferences` (household-scoped values), and
`slots` (all required terminal) rows match the expected state.

**AC-3 — a proxy answer attributes facts to the named member.** In `proxy-answer` (Priya says "his
name is Sam and he's vegetarian too"), the replay results in Sam's `users.name = "Sam"` and Sam's
member preference row carrying the vegetarian diet — attributed to Sam, not Priya. The
`save_member_profile` calls target Sam's `member_user_id`.

**AC-4 — a correction re-writes idempotently.** In `correction` ("actually make that 5–6" after an
earlier `cook_days_count`), the final `household_preferences.cook_days_count` is the corrected value
and there is exactly one household_preferences row for the household (read-merge-write converged, no
duplicate, no leftover slot).

**AC-5 — a conflict scenario is handled.** In `conflict` (two members give incompatible values for
a household-scoped fact), the replay's tool calls + final state match the scenario's declared
resolution, and the harness asserts it deterministically. [ASSUMPTION: the design leaves the exact
conflict resolution to `02`'s group mechanics / the onboarding objective (WI-07); WI-08 encodes
whatever WI-07 specifies as this scenario's expected outcome, and this AC only asserts the harness
can express and check it — not a particular resolution policy invented here.]

**AC-6 — offline vs gated is enforced.** The scripted-model tool/DB assertions run under the
default/offline suite with no model key. The rubric judge runs only under the gated suite and is
skipped (not failed) when no model key is present.

## Test Cases

The harness *is* test infrastructure; these cases verify the harness itself does what it claims.

### Test Case 1: Reference script — tool calls + final rows (AC-1, AC-2)

**Preconditions:** `reference-onboarding` scenario; `migratedFileDb()`; scripted model; stub sender.

**Steps:** run the replay driver; capture recorded tool calls per turn and final DB rows; run it a
second time.

**Expected Outcomes:** every turn's tool calls match `expectToolCalls` in order; final rows match
(1 household, N members, household_preferences populated, all required slots terminal); the two runs
are byte-identical in recorded calls + rows; no network.

### Test Case 2: Proxy answer attributes to the named member (AC-3)

**Preconditions:** `proxy-answer` scenario (Priya speaks for Sam).

**Steps:** run the replay; query `users` for Sam and Sam's member preference row.

**Expected Outcomes:** Sam's name and vegetarian diet are written under Sam's user id; the
`save_member_profile` tool calls carry Sam's `member_user_id`; Priya's row is untouched by those
facts.

### Test Case 3: Correction re-writes idempotently (AC-4)

**Preconditions:** `correction` scenario (an initial `cook_days_count`, then "actually 5–6").

**Steps:** run the replay; query `household_preferences` for the household.

**Expected Outcomes:** exactly one `household_preferences` row; `cook_days_count` = the corrected
value; the corresponding slot is `filled` once (no duplicate, no leftover).

### Test Case 4: Conflict resolves per WI-07's policy (AC-5)

**Preconditions:** `conflict` scenario with the declared expected outcome.

**Steps:** run the replay; assert the recorded tool calls + final rows equal the scenario's declared
resolution.

**Expected Outcomes:** deterministic match; the harness expresses and checks the conflict outcome.

### Test Case 5: Offline suite touches no network; rubric judge is gated (AC-6)

**Preconditions:** run the default suite with no model key set; then run the gated suite with a key.

**Steps:** run `npm test -- eval` (offline); run the gated rubric suite both with and without a key.

**Expected Outcomes:** the offline run passes with no outbound network; the rubric suite is skipped
with no key and runs (records a judgment) with one.

### Test Case 6: Rubric judge checks voice + fidelity (AC-6, gated)

**Preconditions:** a key present; one sampled transcript from `reference-onboarding`.

**Steps:** run the gated rubric judge over the transcript.

**Expected Outcomes:** the judge returns a structured verdict on (a) voice and (b) the fidelity rule
(every `must_say` present, no fact added/dropped/softened); the result is recorded. [The score is
recorded, not asserted as a CI gate — model output is non-deterministic.]

## Test Run

_To be filled by the implementer._ Run:

```
cd server && npm test -- eval            # offline: scripted-model tool + DB assertions
cd server && npx vitest run --config vitest.e2e.config.ts eval-rubric   # gated: real-model judge
```

Record output and a pass/fail (or skip) line per test case.

## Deployment Strategy

Test-only; nothing ships to production. The harness lives under `server/test/eval/` and runs in CI's
offline suite; the rubric judge runs in the gated suite (or locally with a key), never blocking the
fast path. No schema, no runtime code paths.

## Production Verification

This WI has no production surface — it is the offline safety net for WI-04..07. The production
verification of the onboarding behavior it guards is the **manual end-to-end acceptance test** in
the design (`Testing → Manual end-to-end`): the reference script on real iMessage devices against a
dedicated Photon line, every required slot written through, the confetti close delivered. That
manual test is owned by the increment as a whole, not by WI-08.

### Production Verification 1: The harness caught what the manual test would (sanity)

**Preconditions:** the manual acceptance run completed for the reference script.

**Steps:** compare the manual run's resulting DB rows (household, members, preferences) against the
`reference-onboarding` scenario's expected final rows.

**Expected Outcomes:** they agree — the offline scenario is a faithful proxy for the live run; any
divergence is a scenario bug to fix so the harness stays honest.

## Production Verification Run

_To be filled after the manual acceptance run, comparing live DB rows to the scenario's expected
final state._
