---
title: "WI-05 — Response Agent"
feature: imessage-onboarding
increment: 2
branch: jordangaston/imessage-increment-2
depends_on: [WI-04]
status: ready
date: 2026-08-30
---

# WI-05 — Response Agent

## Background

The Chef is two cooperating LLM loops (design:
`docs/imessage-onboarding/increment-2-reasoning-and-onboarding.md`, "Inside the Chef — the two
components"). WI-04 built the reasoning loop, which decides *what* and hands off a `ReplyPlan`.
This WI builds the **response loop** — the simple half — which decides *how to say it*: it renders
the `ReplyPlan` into iMessage bubbles and tapbacks in the chef's voice, and **never touches
Harvest's data**.

It is a small Mastra `Agent` on a **cheap model** (Q-2-1: strong for reasoning, cheap for
response). Its tools **emit messages** rather than change state — `respond_with_text({text})`
appends a text bubble and `react_with_tapback({target, emoji})` appends a reaction — each pushing
onto the turn's `ChatEvents` (design `01-agent-architecture.md` §"The response component (code)").
Input = the `ReplyPlan` (from WI-04) + a short transcript window for tone. **iMessage only** — no
per-channel degradation this increment (SMS/RCS rendering is deferred; design §Scope).

The **fidelity rule** binds it: rephrase and split freely, but never add, drop, or soften a fact,
and always surface every `must_say`. That rule can't be schema-enforced, so it is a **prompt
contract checked by a rubric judge** — a **WI-08 eval**, not an assertion here (design §Testing).

This agent is **internal to the Chef (WI-06)** — the consumer never sees it. It depends on WI-04
(the `ReplyPlan` type + `ChatEvent` type). It follows the existing DeepSeek/stub LLM convention
(`src/parse/extractor.ts`: env-gated `select*`, a `Stub*` double).

> `[ASSUMPTION: exact Mastra API]` `@mastra/core` is added in increment 2 (not yet installed —
> `server/package.json`). API verified against Mastra docs (ctx7 `/mastra-ai/mastra`, 2026-08-30):
> a message-emitting tool is a `createTool` whose `execute` pushes onto a per-request context
> object (here, the turn's `ChatEvents`); step cap via `stopWhen: stepCountIs(n)` (the design
> docs' `maxSteps: 4` is the older name — use `stopWhen: stepCountIs(4)`). The response agent needs
> **no `structuredOutput`** — its output *is* its tool-call side effects (the appended
> `ChatEvents`). **Re-verify against the pinned `@mastra/core` version at build time**, in
> particular how per-request state is threaded into a tool's `execute` (runtime/request context vs.
> a closure over a fresh `ChatEvents[]` per `render()` call — a closure is the lazier, safe default
> if the request-context threading is fiddly).

## Objective

Deliver `src/chef/response-agent.ts`:

1. Two message-emitting tools — `respond_with_text` and `react_with_tapback` — each with a Zod
   `inputSchema`, each appending a `ChatEvent` to the turn's collector, each returning nothing
   (the send is downstream, via the outbox in WI-06).
2. **`responseAgent`** — a small Mastra `Agent`, cheap model, instructions = the chef persona +
   voice/formatting rules + the fidelity rule, tools = the two above.
3. **`render(replyPlan, transcriptWindow)`** — runs the agent (`stopWhen: stepCountIs(4)`) over
   the plan + window and returns the turn's `ChatEvents` (one text event per bubble; a tapback
   event per react intent). `selectResponseAgent()` returns the real agent when the response
   model key is present, else a **StubResponder** (deterministic render, no network).

## Constraints (follow `server/CLAUDE.md`)

- No DI container. Env-gated `select*` factory + a `Stub*` double, mirroring `selectExtractor`.
- **The response agent never writes to Harvest's data** — no command tools, no service calls. Its
  only side effect is appending `ChatEvents`.
- Response model = a cheap model (Q-2-1), wired via Mastra model routing; a model-id constant like
  `extractor.ts`'s `EXTRACTION_MODEL`.
- Methods ≤ ~10 lines; comments only for non-obvious code.
- Tests drive a **scripted/stub model** — no network. As few tests as cover all paths.

## The tools (message-emitting)

```ts
// respond_with_text — the common output; call once per bubble, short is better
inputSchema: z.object({ text: z.string().min(1).max(1000) })
execute: ({ text }, ctx) => ctx.chatEvents.push({ kind: "text", text })

// react_with_tapback — the occasional reaction on a specific inbound message
inputSchema: z.object({
  target: z.string(),                                   // the MessageGuid reacted to
  emoji: z.enum(["love","like","dislike","laugh","emphasize","question"]),
})
execute: (args, ctx) => ctx.chatEvents.push({ kind: "tapback", ...args })
```

`ChatEvent` (from WI-04's shared types): `{ kind:"text"; text } | { kind:"tapback"; emoji;
target }`. (The `reply` variant exists in the type but is not emitted this increment — iMessage
threaded replies are not part of onboarding.)

`render(replyPlan, transcriptWindow)` seeds a fresh `chatEvents: ChatEvent[]` per call, runs the
agent, and returns it. **A fresh collector per `render` call** is required so a reused agent
instance never leaks a prior turn's bubbles (the reset-reused-instances principle,
`docs/harvest-principles.md`).

## Acceptance Criteria

- **AC-1 (renders bubbles):** Given a `ReplyPlan` with N conveyable intents and a scripted model
  that calls `respond_with_text` N times, when `render()` runs, then it returns `ChatEvents` with
  N `kind:"text"` events, in call order.
- **AC-2 (renders a tapback):** Given a `ReplyPlan` whose intent implies a reaction and a scripted
  model that calls `react_with_tapback({target, emoji})`, when `render()` runs, then the returned
  `ChatEvents` contain one `kind:"tapback"` event with that `target` + `emoji`.
- **AC-3 (must_say surfaces):** Given a `ReplyPlan` with a `must_say` item and a scripted model
  that includes it, when `render()` runs, then a returned text event contains that item's meaning.
  _(The **enforcement** of "every must_say always appears / no fact softened" is the WI-08 rubric
  judge, not this assertion — this AC only checks the plumbing carries it through.)_
- **AC-4 (no data writes):** During `render()`, no Harvest service is called and no DB row is
  written — the only effect is the appended `ChatEvents`. (Assert with a spy on the service layer /
  a no-write test db.)
- **AC-5 (fresh collector per call):** Two sequential `render()` calls on the same agent instance
  return independent `ChatEvents` — the second does not contain the first's bubbles.
- **AC-6 (env gate):** Without the response model key, `selectResponseAgent()` returns the
  StubResponder; with it set, the real Mastra agent. (Assert selection, not network.)

## Test Cases

Automated tests use a **scripted model** (no network). The fidelity rule (rephrase freely; never
add/drop/soften a fact; every `must_say` appears) is a **WI-08 rubric-judge eval**, not tested
here.

### Test Case 1: Multi-bubble render (AC-1)

**Preconditions:** `ReplyPlan` with 2 intents. Scripted model calls `respond_with_text` twice
("Kroger's in.", "What days do you usually cook?").

**Steps:** `render(replyPlan, window)`.

**Expected Outcomes:** Returns 2 `kind:"text"` events in that order; no other events.

### Test Case 2: Tapback render (AC-2)

**Preconditions:** `ReplyPlan` whose intent is an acknowledgement; scripted model calls
`react_with_tapback({ target: "<guid>", emoji: "like" })`.

**Steps:** `render(replyPlan, window)`.

**Expected Outcomes:** Returns one `kind:"tapback"` event with `target:"<guid>"`, `emoji:"like"`.

### Test Case 3: must_say carried through (AC-3)

**Preconditions:** `ReplyPlan` with `must_say: ["peanuts never enter this kitchen"]`; scripted
model emits a bubble containing it.

**Steps:** `render(replyPlan, window)`.

**Expected Outcomes:** Some returned text event contains that safety line's meaning.

### Test Case 4: No data writes (AC-4)

**Preconditions:** Service layer spied / no-write test db.

**Steps:** `render(replyPlan, window)` with any plan.

**Expected Outcomes:** Zero service calls, zero DB writes; only `ChatEvents` produced.

### Test Case 5: Fresh collector per render (AC-5)

**Preconditions:** One `responseAgent` instance; scripted model returns one bubble per call.

**Steps:** `render(planA, window)` then `render(planB, window)`.

**Expected Outcomes:** The second result contains only planB's bubble(s); planA's bubble is absent.

### Test Case 6: Env gate selects stub vs real (AC-6)

**Preconditions:** Toggle the response model key presence.

**Steps:** Call `selectResponseAgent()` under each.

**Expected Outcomes:** Absent → StubResponder; present → real Mastra agent. No network call.

## Test Run

_[Placeholder — fill on implementation: `pnpm --filter @harvest/server test src/chef/response-agent.test.ts`, paste output + per-TC pass/fail.]_

## Deployment

Dormant code — nothing calls `render()` until WI-06 wires the Chef (design §Deployment). No schema
change. Shares the `@mastra/core` dependency added by WI-04. Ship with no response model key → the
StubResponder runs (no spend). Going live is an env swap. Rollback: unset the key (falls back to
stub) or roll back the code independently of the additive schema.

## Production Verification

Voice quality and the fidelity rule in production are a **WI-08 rubric-judge eval + the manual
end-to-end run** (design §Testing); this WI's prod verification is limited to wiring — that
rendering produces deliverable iMessage events.

### Production Verification 1: Real responder renders bubbles in the deployed env

**Preconditions:** The response model key set in the deployment.

**Steps:** Trigger one onboarding turn (manual run against the dedicated Photon line) and inspect
the committed outbound `thread_messages` rows for that turn.

**Expected Outcomes:** The real Mastra agent ran (not the stub); the turn committed ≥1 outbound
`text` row (and a `tapback` row where the plan called for one); no service write originated from
the response half.

## Production Verification Run

_[Placeholder — fill after the manual end-to-end run: attach the turn's outbound rows + the log
showing real-responder selection.]_
