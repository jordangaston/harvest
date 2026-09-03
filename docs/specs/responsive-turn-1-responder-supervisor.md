# Responsive Turn 1 — Responder supervisor + reasoner sub-agent

## Background

Today `RealChef.respond` runs a fixed pipeline: `MastraReasoner.run` (DeepSeek, thinking-on, up to
10 tool steps, ~6s + retries) **first, on every message**, then `MastraResponder.render` voices the
plan. So a purely social line — "I can't believe this only takes 20 min!" — gets ignored (the
reasoner tries to advance the objective) or answered in ~8-10s with a goal-flavoured paragraph.
Mechanical, and slow.

Design: `docs/objective-system-v2/RESPONSIVE-TURN-DESIGN.md` (D-01, D-03). This increment **inverts**
the two agents using Mastra's native subagent primitive:

- The **responder becomes a Mastra supervisor `Agent`** (thinking-off) — the front line, run once
  per request.
- The **reasoner becomes a Mastra sub-agent** registered on the responder via `agents: { reasoner }`.
  Mastra auto-exposes it as a delegation tool and decides when to delegate from the sub-agent's
  `description`; the sub-agent's result returns into the supervisor's conversation.

One supervisor run per request: a social message is voiced directly (no delegation); a task-bearing
message is delegated to the reasoner sub-agent, whose `DeliberationResult` the supervisor voices.
The reasoner keeps its exact job — its DB-mutating tools (`update_facts`/`update_tasks`/…) run during
its loop; it never phrases (one mouth).

**Run-to-completion.** `respond` still returns one `ChefReply`; the `Consumer` commits and sends once,
in a single transaction, exactly as today. Mid-turn sends + durability are increment 2
(`responsive-turn-2-midturn-send-durability.md`) — **out of scope here**. No schema change, no
`Consumer` change.

Key current code:
- `server/src/imessage/chef.ts` — `RealChef.respond` (the reasoner→render sequence, lines 84-85), `loadTurn`, `ChefReply`.
- `server/src/chef/reasoning-agent.ts` — `MastraReasoner` (the sub-agent), `ScriptedReasoner`, `selectReasoningAgent`.
- `server/src/chef/response-agent.ts` — `MastraResponder` (the supervisor), `ScriptedResponder`, `renderPrompt`, `CHEF_VOICE`, the `render` tapback grounding rule (line 150).
- `server/src/chef/types.ts` — `ReplyPlan`→`DeliberationResult`, `ChatEvent`, `CHEF_TAPBACK_KINDS`.
- `server/src/chef/tools/registry.ts` — `buildTools(ctx, db, def.tools)` (the reasoner sub-agent's tools).
- Mastra subagents API — verify against live docs: `agents:` map on `new Agent`, `description` drives delegation (context7 `/mastra-ai/mastra`, `docs/subagents.mdx`, `docs/agents/tools.mdx`).

**Definitions.** *Supervisor* — the responder Mastra agent that runs first and decides whether to
delegate. *Sub-agent* — the reasoner, exposed to the supervisor as a delegation tool. *Delegate* —
the supervisor handing the sub-agent a natural-language task; its result returns to the supervisor.

## Objective

Make the responder a Mastra supervisor agent with the reasoner as a sub-agent. `RealChef.respond`
invokes the responder once; the responder voices social messages directly and delegates task-bearing
ones to the reasoner sub-agent, voicing the returned `DeliberationResult`. Reshape the reasoner's
output from `ReplyPlan` to `DeliberationResult { communicate, ask, artifacts? }`. Run-to-completion;
one `ChefReply` returned.

```ts
type DeliberationResult = {
  communicate: string[]    // points to convey — facts, confirmations, the upshot of deep thinking
  ask: string[]            // questions to advance the objective (0+)
  artifacts?: Artifact[]   // structured payloads too rich for a sentence
}
type Artifact = { kind: 'richlink'; url: string }   // extend later: 'meal_plan', 'recipe_card'
```

## Acceptance Criteria

1. **Given** a purely social trigger, **when** `respond` runs, **then** the responder supervisor
   voices a reply (tapback or ≤2 short bubbles) and **does not delegate** to the reasoner sub-agent
   (the reasoner's tools/loop never run).
2. **Given** a task-bearing trigger (an allergy, an answer, a request), **when** `respond` runs,
   **then** the supervisor delegates to the reasoner sub-agent exactly once, the reasoner's tool loop
   runs (facts/tasks persist as today), and the supervisor voices the returned `DeliberationResult` —
   every `communicate` line and every `ask` question appears in the reply in meaning, and each
   `artifact` renders through its existing send path (`richlink` → `[richlink:<url>]` body).
3. **Given** the supervisor is uncertain whether a message bears on the objective, **then** it
   delegates (bias-to-delegate — a dropped request is worse than an extra reasoner run). This is the
   load-bearing correctness property; it is carried by the supervisor's instructions.
4. **Given** a delegated turn whose reasoner loop ends with no valid structured object after retries,
   **then** the delegation returns an empty `DeliberationResult` (`{ communicate: [], ask: [] }`) and
   the turn degrades exactly as today's empty-plan fallback (no bubbles, no confirm, no objective pop).
5. **Given** a social (non-delegated) turn, **when** `respond` returns, **then** `confirmTasks` is
   `[]` and `cursorTo`/`objectiveId` come from the loaded turn, so the `Consumer` commits the bubbles,
   confirms nothing, and does not pop the objective.
6. **Given** `DEEPSEEK_API_KEY` is unset (offline), **then** the scripted responder/reasoner run with
   no network: the scripted supervisor delegates deterministically to the scripted reasoner, which
   returns a fixed `DeliberationResult`. Existing offline tests keep passing.
7. **Given** a social reply of kind `react` with a null `triggerExternalId`, **then** it degrades to a
   short text bubble — never a tapback with no real target (same grounding rule as today's `render`,
   response-agent.ts:150).
8. **Given** `DeliberationResult` replaces `ReplyPlan`, **then** `types.ts`, both agents, the scripted
   doubles, `renderPrompt`, and every test referencing `intents`/`must_say` are updated and the full
   server suite passes (baseline: the 2 `test/media.test.ts` ffmpeg-static failures are pre-existing).

## Test Cases

### Test Case 1: Social trigger is voiced without delegation (AC 1, 5)

**Preconditions:** A `RealChef` built with the `imessage-consumer-logic.test.ts` harness — a scripted
reasoner **spied** with `vi.spyOn`, a scripted supervisor configured to treat the trigger as social.
One pending inbound with `externalId = 'trig-1'`.

**Steps:**
1. Call `chef.respond(threadId)`.

**Expected Outcomes:**
- The reasoner sub-agent was **not** invoked (spy not called).
- `chatEvents` is the social reply (a `love` tapback on `trig-1`, or ≤2 text bubbles).
- `confirmTasks` is `[]`; `cursorTo` = the pending id; `objectiveId` = the active objective id.

### Test Case 2: Task trigger delegates once and is voiced (AC 2)

**Preconditions:** Same harness; scripted reasoner returns `{ communicate: ['noting peanuts as a
severe allergy for Sam'], ask: ['which store do you shop at?'] }`; supervisor configured to delegate.

**Steps:**
1. Call `chef.respond(threadId)`.

**Expected Outcomes:**
- The reasoner sub-agent was invoked exactly once.
- The reply conveys both the communicate line and the ask question in meaning.

### Test Case 3: Empty deliberation degrades cleanly (AC 4)

**Preconditions:** Scripted reasoner returns `{ communicate: [], ask: [] }`; supervisor delegates.

**Steps:**
1. Call `chef.respond(threadId)`.

**Expected Outcomes:**
- `chatEvents` is empty; the Consumer confirms nothing and does not pop the objective.

### Test Case 4: Artifact renders as a richlink (AC 2)

**Preconditions:** Scripted reasoner returns `{ communicate: ["here's a recipe"], ask: [],
artifacts: [{ kind: 'richlink', url: 'https://x/y' }] }`.

**Steps:**
1. Call `chef.respond(threadId)`.

**Expected Outcomes:**
- `chatEvents` contains a `richlink` event for the URL (existing `sendLink` path unchanged).

### Test Case 5: Offline scripted path, no network (AC 6)

**Preconditions:** `DEEPSEEK_API_KEY` unset; `selectResponseAgent()` / `selectReasoningAgent()` return
the scripted doubles.

**Steps:**
1. Run a task turn through the scripted supervisor + scripted reasoner.

**Expected Outcomes:**
- No network call; the fixed `DeliberationResult` is voiced deterministically.

### Test Case 6: `react` with no target degrades to text (AC 7)

**Preconditions:** A social reply of kind `react` with `triggerExternalId = null`.

**Steps:**
1. Produce the social reply.

**Expected Outcomes:**
- One `text` bubble, no `tapback`.

### Test Case 7: Full suite green after the reshape (AC 8)

**Steps:**
1. Run `pnpm exec vitest run` (server).

**Expected Outcomes:**
- All pass except the 2 pre-existing `media.test.ts` ffmpeg-static failures; no `ReplyPlan.intents`/
  `must_say` references remain.

## Test Run

_To be filled in during execution._

## Deployment Strategy

Direct deploy behind the existing `DEEPSEEK_API_KEY` env gate — offline/test envs run the scripted
supervisor + scripted reasoner, so their behaviour is unchanged. Internal refactor of the
reasoning/response contract: no external interface, no schema, no `Consumer` change. Rollback is a
code revert.

`[ASSUMPTION: no separate feature flag — the two-agent chef is gated only by DEEPSEEK_API_KEY today.]`

## Production Verification

### Production Verification 1: Social message gets a fast, human reply

**Preconditions:** A real iMessage thread with an active objective. Logs.

**Steps:**
1. Send "this looks amazing 😍".

**Expected Outcomes:**
- A tapback or one-line warm reply in ~1-2s; logs show no delegation to the reasoner sub-agent for
  that turn.

### Production Verification 2: Task message still captures and confirms

**Preconditions:** Same thread.

**Steps:**
1. Send "actually I'm allergic to shellfish".

**Expected Outcomes:**
- The allergy persists (reasoner delegated) and the reply confirms it — same observable behaviour as
  before, now via delegation.

## Production Verification Run

_To be filled in during execution._
