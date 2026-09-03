# WI-4: Merge the chef's reasoner and responder into one agent

## Background

The chef runs two Mastra agents per turn today. A **reasoner** (`reasoning-agent.ts`,
thinking-on) owns the objective DB tools and emits a `DeliberationResult`; a **responder**
(`response-agent.ts`, thinking-off) owns the `send` tool and voice, reaching the reasoner
through a `deliberate` tool. The split hands facts across a lossy `{communicate, ask}`
interface — the reasoner decides tone-blind, the responder voices facts it did not derive —
and costs a responder→`deliberate`(two-phase)→responder round-trip every task turn.

The reasoner's two-phase shape (tool loop, then a *separate* tool-free `structuredOutput`
pass) exists only to dodge a Mastra failure mode: a tool loop that saturates its step budget
ends on a tool call with empty text, so a `structuredOutput` over that final text yields
`object` undefined and Mastra retries the whole loop 3× (~95–210s). Collapsing to one agent
whose only output is `send` calls **removes structured output entirely**, so that two-pass
latency bug cannot occur.

Design of record: `docs/objective-system-v2/MERGE-AGENTS-DESIGN.md`. This is a deletion-heavy
change: one agent reads the message, holds the objective, calls the tools, and speaks — full
context on both sides.

## Objective

Replace the reasoner + responder with **one** Mastra `Agent` per turn that owns the active
objective's reasoning tools *and* the `send` tool, runs a single tool loop with no structured
output, and speaks only through `send`. Preserve the Consumer + `LiveOutboundSink` durability
untouched. Reconcile the offline test seam to a single scripted-agent double.

### Verified model knob (design `[VERIFY]`)

Thinking-on-LOW for DeepSeek via `@mastra/core`'s OpenAICompatible config is:

```ts
providerOptions: { deepseek: { thinking: { type: 'enabled' }, reasoningEffort: 'low' } }
```

Evidence:
- `@mastra/core@1.63.2` `dist/_types/@ai-sdk_deepseek-v6/dist/index.d.ts` types the DeepSeek
  provider options as `thinking: { type: 'adaptive' | 'enabled' | 'disabled' }` **and**
  `reasoningEffort: 'low' | 'medium' | 'high' | 'xhigh' | 'max'`. A granular `low` exists.
- Mastra's OpenAICompatible model (`dist/dist-D4qFvPct.js`) forwards `reasoningEffort` as the
  request-body field `reasoning_effort`, and passes any non-schema provider-option key
  (`thinking`) through verbatim into the body.
- DeepSeek API docs (ctx7 `/websites/api-docs_deepseek`, `guides/thinking_mode`): thinking-on
  requires **both** `reasoning_effort` and `extra_body={"thinking":{"type":"enabled"}}`. Our
  `providerOptions` above produce exactly that request.

Thinking is kept ON (thinking-off once conflated household members); `low` caps the think cost.

## Acceptance Criteria

- **AC-1 — one agent, its tools:** `chef.ts respond(threadId, sink)` builds ONE Mastra agent
  whose tools are the active objective's `buildTools(ctx, db, def.tools)` **plus** a `send` tool
  bound to `sink.send`. No second agent, no `deliberate` tool.
- **AC-2 — no structured output:** the agent runs one `generate` per turn with
  `stopWhen: steps >= MAX_STEPS` and **no** `structuredOutput`. Output is only `send` calls.
- **AC-3 — thinking-on-LOW:** the live agent runs with
  `providerOptions: { deepseek: { thinking: { type: 'enabled' }, reasoningEffort: 'low' } }`.
- **AC-4 — merged prompt:** the single system prompt merges the reasoning conduct + `HARD_RULE`
  (from `briefing.ts`), the `CHEF_VOICE` persona (from `response-agent.ts`), and the
  social-vs-work + ack-first rules. `prepareBriefing(input)` output is the turn input.
- **AC-5 — `worked` gate replaces `deliberated`:** a turn that ran any **mutating** tool
  (`update_tasks`/`update_facts`/`create_household`/`import_recipe`) is a working turn and
  returns the loaded fact-less `confirmTasks`; a `send`-only (social) turn returns
  `confirmTasks: []`. `read_facts`/`fact_types` do not count as work.
- **AC-6 — deletions:** `reasoning-agent.ts` (`Reasoner`/`MastraReasoner`/`ScriptedReasoner`,
  two-phase), the `deliberate` tool + `SupervisorTurn.deliberate` seam, and
  `DeliberationResult`/`ReasoningOutput` types + `isEmptyDeliberation` are gone. No source or
  test imports them.
- **AC-7 — durability untouched:** `consumer.ts` `LiveOutboundSink` (deterministic
  `${triggerId}#${ordinal}` guids, `trigger_id` tagging, cursor-last, redelivery dedup) is
  byte-for-byte unchanged.
- **AC-8 — one scripted double:** the offline seam is ONE scripted agent double that records
  tool calls + sends and drives the `sink`; `selectChefAgent()` returns the live Mastra agent
  when `DEEPSEEK_API_KEY` is set, else the scripted double.
- **AC-9 — green bar:** `tsc --noEmit` clean; full `vitest run` passes except the two
  pre-existing `media.test.ts` ffmpeg-static failures.
- **AC-10 — ack-first instruction present:** the prompt instructs the agent to `send` a brief
  warm ack as its FIRST action on a working turn. (Live effectiveness is measured by the
  coordinator, not asserted here.)

## Test Cases

### Test Case 1: one agent with objective tools + send (AC-1, AC-2)

**Preconditions:** `DEEPSEEK_API_KEY` set to a non-network dummy; a seeded onboarding turn.

**Steps:** Build the live `ChefAgent` and inspect its constructed Mastra `Agent`: assert its
tool ids equal the objective's `buildTools` ids ∪ `{send}`, that no `deliberate` id is present,
and that `generate` is invoked with a `stopWhen` and no `structuredOutput` key. (Assert via a
unit test that constructs the agent and inspects the tool map / generate options, mocking
`Agent.generate`.)

**Expected Outcomes:** tool set is `{...objectiveTools, send}`; no `deliberate`; generate
called once with `stopWhen`, `providerOptions`, and no `structuredOutput`.

### Test Case 2: social turn — send only, no work (AC-5)

**Preconditions:** seeded thread + one inbound; scripted double in "social" mode (one `send`,
no mutating tool).

**Steps:** `chef.respond(threadId, sink)`.

**Expected Outcomes:** exactly the one bubble reaches the sink; `reply.confirmTasks === []`;
`reply.cursorTo`/`objectiveId` come from the loaded turn; `reply.delivered === true`.

### Test Case 3: working turn — mutating tool ran, fact-less tasks confirmed (AC-5)

**Preconditions:** seeded thread with a fact-less task loaded; scripted double in "work" mode
(calls a mutating tool then sends `communicate`/`ask` lines).

**Steps:** `chef.respond(threadId, sink)`.

**Expected Outcomes:** the sent texts reach the sink; `reply.confirmTasks` equals the loaded
fact-less tasks (non-empty); `delivered === true`.

### Test Case 4: empty turn degrades cleanly (AC-5, AC-9)

**Preconditions:** scripted double that neither sends nor mutates.

**Steps:** `chef.respond(threadId, sink)`.

**Expected Outcomes:** no events on the sink; `confirmTasks === []`; `delivered === false`.

### Test Case 5: durability + dedup preserved (AC-7)

**Preconditions:** the existing consumer-logic durability cases (trigger_id tagging, crash /
redelivery no-double-send, atomic confirm/cursor rollback).

**Steps:** run the full `imessage-consumer-logic.test.ts` suite against a scripted-agent chef.

**Expected Outcomes:** every existing durability assertion passes unchanged (outbound rows
tagged `trigger_id`, deterministic `#0/#1` guids, exactly-once send across a crash, cursor
unmoved on rollback).

### Test Case 6: deletions removed (AC-6)

**Preconditions:** the merged tree.

**Steps:** `grep` the `src` + `test` trees for `reasoning-agent`, `DeliberationResult`,
`ReasoningOutput`, `deliberate`, `MastraReasoner`, `ScriptedReasoner`, `SupervisorTurn`.

**Expected Outcomes:** no hits outside this spec/design docs; `tsc --noEmit` is clean (proves
no dangling import).

### Test Case 7: thinking-on-LOW knob (AC-3)

**Preconditions:** live `ChefAgent` with a dummy key; `Agent.generate` mocked.

**Steps:** run one turn; capture the options passed to `generate`.

**Expected Outcomes:** `providerOptions.deepseek` equals
`{ thinking: { type: 'enabled' }, reasoningEffort: 'low' }`.

### Test Case 8: env gate (AC-8)

**Preconditions:** toggle `DEEPSEEK_API_KEY`.

**Steps:** call `selectChefAgent()` with the key absent, then present.

**Expected Outcomes:** absent → the scripted double; present → the live Mastra `ChefAgent`.

## Test Run

To be filled by the implementer: `pnpm exec tsc --noEmit` from `server/`, then
`pnpm exec vitest run`. Record pass/fail per case; confirm only the two `media.test.ts`
ffmpeg-static failures remain.

## Deployment Strategy

Pure server change, no migration, no new env var (reuses `DEEPSEEK_API_KEY`). Ships on the
existing chef path. The Consumer/sink transport is unchanged, so an in-flight turn's durability
guarantees are preserved across deploy. Roll back by reverting the commits.

## Production Verification

### Production Verification 1: fresh-household onboarding voice + latency + ack timing

**Preconditions:** a reset household on a real iMessage thread; the merged build deployed.

**Steps:** run the real iMessage onboarding end to end against the merged agent; compare to the
split baseline (PR #80): voice quality, per-turn latency, and whether the warm ack lands before
the heavy think.

**Expected Outcomes:** voice quality is at least at parity; latency is no worse (expected
better — one round-trip, no structured second pass); ack-timing behavior is recorded. A
thinking model front-loads reasoning, so if the ack lands only after the think, log it as a
finding (do not pre-build a cheap thinking-off ack pre-pass until proven necessary — design
§"the one risk").

## Production Verification Run

To be filled by the coordinator (the implementer cannot live-test).

## Out of scope

The early-completion bug (`isComplete` fires early → `completeAndPop` pops onboarding
mid-flow → re-seed) is separate. Flagged, not fixed here.
