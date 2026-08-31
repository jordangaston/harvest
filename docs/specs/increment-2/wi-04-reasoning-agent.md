---
title: "WI-04 — Reasoning Agent + Briefing"
feature: imessage-onboarding
increment: 2
branch: jordangaston/imessage-increment-2
depends_on: [WI-03]
status: ready
date: 2026-08-30
---

# WI-04 — Reasoning Agent + Briefing

## Background

Increment 2 replaces the increment-1 stub Chef with the real two-loop implementation
(design: `docs/imessage-onboarding/increment-2-reasoning-and-onboarding.md`,
"Inside the Chef — the two components"). The **reasoning agent** is the first loop: it
decides *what needs to happen and what needs to be said*. It pursues the active objective
on the thread's stack, changes the world only through validated **command tools** (WI-03),
judges which slots just got filled, and hands off a `ReplyPlan` + `slotUpdates` — **no
persona, no prose** (the response agent, WI-05, owns voice).

The reasoning agent is a Mastra `Agent` (D2-4 lands Mastra this increment). Its **resident
tools are resolved per turn** from the active objective's tool set, filtered to
`canRun(state)`; every other eligible tool stays reachable through `ToolSearchProcessor`
so the agent is never stranded ("Focus and legality are separate levers", design §Operations).
The **briefing** (`prepareBriefing`) assembles the L1/L2/L3 context per the memory-hierarchy
discipline (`vertical-agent-design`).

This agent is **internal to the Chef (WI-06)** — the consumer never sees it. It depends on
WI-03 (the command tools + `SaveResult` + `canRun`) and the objective/slot state
(`objective-store.ts`, delivered alongside). It follows the existing DeepSeek/stub LLM
convention (`src/parse/extractor.ts`: `selectExtractor`, `StubExtractor`, env-gated
selection); the reasoning model defaults to DeepSeek (Q-2-1). LLM is stubbed in automated
tests — real-model behaviour is a WI-08 eval concern.

> `[ASSUMPTION: exact Mastra API]` `@mastra/core` is **not yet installed** (verified in
> `server/package.json`); this increment adds `@mastra/core`, `@mastra/memory`,
> `@mastra/libsql`. The API below is verified against Mastra docs (ctx7 `/mastra-ai/mastra`,
> 2026-08-30): dynamic tools via `tools: async ({ runtimeContext }) => ({...})`; structured
> output via `agent.generate(input, { structuredOutput: { schema } })` → `response.object`;
> step cap via `stopWhen: stepCountIs(n)` (the design docs' `maxSteps: 6` is the older name —
> use `stopWhen: stepCountIs(6)`); `ToolSearchProcessor({ tools, includeResolvedTools: true,
> filter })` where `filter({ toolName, requestContext, phase })` is where `canRun` maps onto
> the search/load filter. **Re-verify against the pinned `@mastra/core` version at build time.**

## Objective

Deliver `src/chef/reasoning-agent.ts` and `src/chef/briefing.ts`:

1. **`prepareBriefing(context)`** — pure assembly of the reasoning agent's L1/L2/L3 context
   and the resident tool set, from the loaded chef state (active objective, unfilled slots,
   members, transcript window, framed trigger). No network, no model call.
2. **`reasoningAgent`** — a Mastra `Agent` (`selectReasoningAgent()` returns the real agent
   when `DEEPSEEK_API_KEY` is present, else a scripted/stub reasoner — the env-select pattern
   of `selectExtractor`). Instructions = conduct + safety only (no persona). Tools resolved
   per turn = the active objective's tools ∩ `canRun(state)`; the rest searchable via
   `ToolSearchProcessor`. Structured output = `{ replyPlan: ReplyPlan; slotUpdates: SlotUpdate[] }`
   — never prose.
3. **`runReasoning(state)`** (or the agent's `generate` wrapped) — runs the Mastra tool loop
   (`stopWhen: stepCountIs(6)`), each tool `execute` running its `canRun` guard then the
   in-process service call (WI-03), and returns a **validated** `{ replyPlan, slotUpdates }`.

## Constraints (follow `server/CLAUDE.md`)

- No DI container. Singletons + classes/functions with `static create()` / a `select*` factory.
  Zod-validated structured output at the model boundary (`ReplyPlanSchema.parse` / Mastra's
  `structuredOutput` schema).
- Reuse WI-03's tools and `SaveResult`; **do not** re-implement `canRun` or the services here.
- Reasoning model default = DeepSeek (Q-2-1), wired via Mastra's model routing, mirroring the
  `EXTRACTION_MODEL` constant convention in `extractor.ts`.
- Methods ≤ ~10 lines; comments only for non-obvious code.
- Tests drive a **scripted/stub model** — no network. As few tests as cover all paths.
- **The hard L1 rule** (design §briefing): a value the tools didn't return is **never written** —
  off-catalog answers degrade to acknowledged-and-dropped, never guessed. This is a prompt
  contract in the instructions **and** enforced structurally by the `canRun`/`SaveResult`
  chokepoint (a guess never becomes a `filled` slot because it never lands a write).

## The briefing — L1/L2/L3 (`prepareBriefing`)

`prepareBriefing(context)` assembles, by code (the model never assembles its own context):

- **L1 — resident every turn:** conduct + safety rules; the active objective (instructions,
  completion criteria, and **only the UNFILLED slots** — `status != 'filled'`); a one-line
  inventory of any suspended objectives; the household's members (name, handle); the transcript
  window; the active objective's resident tools; the framed trigger (the pending inbound past
  the cursor).
- **L2 — the active objective's instruction body, condition-gated:** onboarding's tastes
  drill-down, the allergy ladder — injected while onboarding is active (design §L2).
- **L3 — grounding & discovery:** `search_catalog` grounds *data* (full taste catalog,
  store/equipment/diet/allergen enums); `ToolSearchProcessor` grounds *capability* (the
  withheld-but-eligible tools). Carries the hard L1 rule text.

`prepareBriefing` returns `{ messages | prompt, residentTools, requestContext }` — the
resident tool set and the `requestContext` (carrying `chefState`) that the agent and the
`ToolSearchProcessor.filter` read. It is a **pure function of the loaded state** — unit-testable
without a model.

## The reasoning agent (`reasoning-agent.ts`)

```ts
// resident set = active objective's tools ∩ canRun(state), resolved per turn
tools: async ({ runtimeContext }) => residentTools(runtimeContext.get("chefState"))
// the rest stay searchable; canRun maps onto the filter's 'search'/'load' phases
inputProcessors: [new ToolSearchProcessor({
  tools: allEligibleTools,
  includeResolvedTools: true,
  filter: ({ toolName, requestContext, phase }) =>
    canRunByName(toolName, requestContext.get("chefState")),   // legality gate
})]
```

- **Instructions** = `CONDUCT_AND_SAFETY` (no persona), including "search for a tool when you
  need a capability you don't have" and the hard L1 rule.
- **Structured output schema** = `z.object({ replyPlan: ReplyPlanSchema, slotUpdates:
  z.array(SlotUpdateSchema) })`, passed as `structuredOutput.schema`; the result is read from
  `response.object` and re-parsed defensively.
- **`SlotUpdate`** = `{ key: SlotKey; status: SlotStatus }` — the agent's *declaration* of which
  slots changed; the turn (WI-06) applies them under the code-enforced invariant (a value-bearing
  slot becomes `filled` only if a write landed). This spec produces the declaration; it does not
  apply it.

`selectReasoningAgent()` returns the real Mastra agent when `DEEPSEEK_API_KEY` is set, else a
**ScriptedReasoner** — a test double that returns a caller-supplied sequence of tool-call
intents + a fixed `{ replyPlan, slotUpdates }`, running the real tools' `execute` (so `canRun`
and `SaveResult` are exercised) but making no network call. Both satisfy one interface:

```ts
interface Reasoner {
  run(state: ChefState): Promise<{ replyPlan: ReplyPlan; slotUpdates: SlotUpdate[] }>;
}
```

## Acceptance Criteria

- **AC-1 (runs the tools, returns a validated plan):** Given a briefing and a scripted model
  that returns tool calls, when the agent runs, then each named tool's `execute` runs
  (`canRun`-guarded), and the agent returns a `{ replyPlan, slotUpdates }` that **parses**
  against `ReplyPlanSchema` / `SlotUpdateSchema`.
- **AC-2 (resident set = objective's tools ∩ canRun):** Given an objective whose tool list
  includes a tool whose `canRun(state)` is `false` for the current state, when `prepareBriefing`
  resolves the resident set, then that tool is **absent** from the resident set (and present
  only in the searchable set).
- **AC-3 (withheld-but-eligible tool reachable via search):** Given a tool that is eligible
  (`canRun` true) but **not** in the active objective's resident list, when the scripted model
  issues a tool-search + load for it, then the `ToolSearchProcessor.filter` **allows** it and it
  becomes callable.
- **AC-4 (off-catalog value dropped, not guessed):** Given the model attempts to save a value
  the tool rejects (`SaveResult.rejected`, no catalog match), when the turn completes, then no
  `slotUpdate` for that slot is `filled` (the value never landed) and the `ReplyPlan` carries an
  `acknowledge` intent, never a fabricated `confirm`.
- **AC-5 (briefing loads only unfilled slots):** Given an objective with a mix of `filled` and
  unfilled slots, when `prepareBriefing` runs, then the L1 context contains **only** the
  `status != 'filled'` slots.
- **AC-6 (env gate):** With no `DEEPSEEK_API_KEY`, `selectReasoningAgent()` returns the
  scripted/stub reasoner; with it set, it returns the real Mastra agent. (Assert selection, not
  network.)
- **AC-7 (no prose):** The reasoning agent's structured output contains no free-text reply — only
  `intents` / `must_say` / `address` (ReplyPlan) and `slotUpdates`. (Schema has no prose field.)

## Test Cases

Automated tests use a **scripted model** (no network). The real-model behaviour (does it extract
the right value, ask the right slot) is a **WI-08 eval**, not tested here.

### Test Case 1: Scripted turn runs tools and returns a validated plan (AC-1, AC-7)

**Preconditions:** Seeded `file:` test db with an active `onboarding` objective, one member, and
its unfilled slots. Scripted reasoner set to call `save_household_profile({cook_days_count: 5})`
then emit `{ replyPlan: { intents: [{kind:"confirm", fact:"5 cook days"}], must_say: [] },
slotUpdates: [{key:"household.cook_days_count", status:"filled"}] }`.

**Steps:** Build state → `prepareBriefing(state)` → `reasoner.run(state)`.

**Expected Outcomes:** `save_household_profile.execute` ran (its `canRun` passed, service called);
the returned object `ReplyPlanSchema.parse`-es and `SlotUpdateSchema.array().parse`-es; no prose
field is present.

### Test Case 2: canRun filters the resident set (AC-2)

**Preconditions:** An objective listing a tool whose `canRun(state)` is `false` (e.g.
`save_member_profile` for a `member_user_id` not yet in the household).

**Steps:** `prepareBriefing(state)` → inspect `residentTools`.

**Expected Outcomes:** The ineligible tool is **not** in `residentTools`; it appears in the
`ToolSearchProcessor`'s searchable set.

### Test Case 3: Withheld-but-eligible tool reachable via search (AC-3)

**Preconditions:** An eligible tool (`canRun` true) omitted from the active objective's resident
list. Scripted model issues `search_tools` then `load_tool` for it, then calls it.

**Steps:** `reasoner.run(state)`.

**Expected Outcomes:** The `filter({phase:"search"|"load"})` returns `true`; the tool's `execute`
runs; its result reaches the model.

### Test Case 4: Off-catalog value dropped, not guessed (AC-4)

**Preconditions:** Scripted model calls `save_household_profile({grocery_stores:["piggly
wiggly's little cousin"]})`; the service returns `SaveResult.rejected` (no catalog match).

**Steps:** `reasoner.run(state)`.

**Expected Outcomes:** No `slotUpdate` marks the store slot `filled`; the `ReplyPlan` has an
`acknowledge` intent (not a `confirm`). No row was written for the rejected value.

### Test Case 5: Briefing loads only unfilled slots (AC-5)

**Preconditions:** Objective with 3 `filled` + 4 unfilled slots.

**Steps:** `prepareBriefing(state)`.

**Expected Outcomes:** The assembled L1 context references exactly the 4 unfilled slots.

### Test Case 6: Env gate selects stub vs real (AC-6)

**Preconditions:** Toggle `DEEPSEEK_API_KEY` presence.

**Steps:** Call `selectReasoningAgent()` under each.

**Expected Outcomes:** Absent → scripted/stub reasoner; present → real Mastra agent. No network
call made.

## Test Run

_[Placeholder — fill on implementation: `pnpm --filter @harvest/server test src/chef/reasoning-agent.test.ts src/chef/briefing.test.ts`, paste output + per-TC pass/fail.]_

## Deployment

Dormant code — nothing calls the reasoning agent until WI-06 wires the Chef and a thread reaches
"same kitchen" (design §Deployment: reasoning/response code ships dormant behind the additive
migrations). No schema change in this WI (the `objectives`/`slots` tables are their own migration
WI). Add `@mastra/core`, `@mastra/memory`, `@mastra/libsql` to `server/package.json`. Ship with
no `DEEPSEEK_API_KEY` in an env → the scripted stub runs (no spend). Going live is an env swap.
Rollback: unset the key (falls back to stub) or roll back the code independently of the additive
schema.

## Production Verification

Reasoning quality in production is a **WI-08 eval + the manual end-to-end run** (design §Testing
"Manual end-to-end"); this WI's prod verification is limited to selection + wiring.

### Production Verification 1: Real reasoner is selected in the deployed env

**Preconditions:** `DEEPSEEK_API_KEY` set in the deployment.

**Steps:** Trigger one onboarding turn (manual run against the dedicated Photon line) and inspect
the turn's structured logs.

**Expected Outcomes:** The real Mastra agent ran (not the stub); at least one command tool
executed with a `canRun` pass and a `SaveResult`; the turn produced a `ReplyPlan` + `slotUpdates`
(no prose in the reasoning output).

## Production Verification Run

_[Placeholder — fill after the manual end-to-end run: attach the turn log showing real-model
selection + a landed command + the ReplyPlan.]_
