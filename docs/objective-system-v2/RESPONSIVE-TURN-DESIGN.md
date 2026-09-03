---
tags: [harvest, chef], tdd
summary: "Responsive turn: invert responder/reasoner so the chef reacts fast and thinks on demand"
locked: false
---

# Responsive Turn — Design

**Problem.** Every inbound message pays the full deliberation cost. The reasoner
(DeepSeek, thinking-on, up to 10 tool steps) runs *first* on every message and always
tries to advance the active objective, so a purely social line ("I can't believe this
only takes 20 min!") is either ignored or answered in ~8-10s with a goal-flavoured
paragraph. The mechanical feel and the latency are the same bug: the system has no way
to *not* think, and no way to acknowledge before it finishes thinking.

**Fix.** Invert the two agents that already exist. The fast conversational agent
(**responder**, thinking-off) becomes the front line; the deliberator (**reasoner**,
thinking-on + tools) becomes a tool it *reaches for* — `deliberate(question)`. Give the
responder a `send` tool so it can reply mid-turn without returning. Social messages never
wake the reasoner (fast, cheap, human). Task messages get an optional contextual ack,
then hidden deliberation, then a result — all in one voice.

This is a rewiring of `MastraResponder`, `MastraReasoner`, and `Consumer`. No new model.

---

# Reviews

| Reviewer | Status | Feedback |
|---|---|---|
| Jordan | in_progress | Verbal design agreed; doc under review |

---

# Use Case Implementations

## F-01: Respond to a conversational (non-task) message

Responder reacts and stops. The reasoner is never invoked.

~~~mermaid
sequenceDiagram
    participant C as Consumer
    participant R as Responder (thinking-off)
    participant S as Sender
    participant DB as Turso

    C->>DB: loadPendingInbound(threadId, cursor)
    C->>R: run(transcript + objectiveSummary)
    note over R: judges: purely social → no deliberation
    R->>S: send(tapback ❤️ | short bubble)
    S->>DB: insertOutbound(trigger_id) + markSent
    R-->>C: turn done
    C->>DB: advanceCursor(threadId, triggerId)
~~~

## F-02: Respond to a task-bearing message

Responder acks (contextually — often nothing or a tapback), calls `deliberate`, then
voices the result. Two send points with a slow, crashable gap between them.

~~~mermaid
sequenceDiagram
    participant C as Consumer
    participant R as Responder (thinking-off)
    participant D as deliberate() = Reasoner (thinking-on + tools)
    participant S as Sender
    participant DB as Turso

    C->>R: run(transcript + objectiveSummary)

    opt contextual ack
        R->>S: send("on it 🤔") / tapback
        S->>DB: insertOutbound(trigger_id) + markSent
    end

    R->>D: deliberate createTool: "How do I move toward the objective?"
    note over D: execute calls reasoner.run;<br/>owns objective + DB tools; upserts (idempotent)
    D-->>R: DeliberationResult { communicate, ask, artifacts? }

    R->>S: send(result bubbles)
    S->>DB: insertOutbound(trigger_id) + markSent
    R-->>C: turn done
    C->>DB: advanceCursor(threadId, triggerId)
~~~

## F-02 extension: crash between ack and result (resume)

Cursor advances **last**, so a crash before the result leaves the cursor unmoved and the
queue redelivers the doorbell. On re-entry the responder must not re-ack. It reads its own
already-sent outbound rows for this trigger and continues from there.

~~~mermaid
sequenceDiagram
    participant C as Consumer
    participant R as Responder
    participant DB as Turso

    note over C: redelivery — cursor unmoved, trigger still pending
    C->>DB: loadOutbound(trigger_id)
    DB-->>C: [ack row already sent]
    C->>R: run(transcript + priorSends=[ack])
    note over R: sees it already acked →<br/>skips ack, goes straight to deliberate
~~~

**Re-entry states**, derived from outbound rows tagged with `trigger_id`:

| State | Evidence | Action |
|---|---|---|
| fresh | no outbound for trigger | ack (maybe) → deliberate → result |
| acked, not finished | ack row exists, no result row | skip ack → deliberate → result |
| done | result row exists | advance cursor, stop |

Reasoner mutations are idempotent upserts (`update_facts`/`update_tasks` by task), so
re-running `deliberate` converges. Sends are deduped by `trigger_id`. Cursor last. That is
the whole durability contract.

---

# Modules

The responder is **one Mastra `Agent`** (thinking-off) that runs **one agentic `generate` per
turn**. It has two tools: **`send`** — the single outbound tool for every kind (text, tapback,
richlink now; threaded replies + cards later) — and **`deliberate`**, a `createTool` whose `execute`
calls `reasoner.run` and returns the real `DeliberationResult`. The reasoner is **its own Mastra
`Agent`** (thinking-on). The model acts *only* by calling tools; its `send` calls ARE the reply.

> **No structured output, so no two-pass gotcha.** Because `send` is a tool, there is no
> `structuredOutput:{bubbles}` to conflict with a tool call — the structured-output-vs-tool-call
> two-pass problem simply doesn't arise. And **not** Mastra native `agents:{}` sub-agents (D-03):
> verified against `@mastra/core@1.63.2`, native delegation returns only the sub-agent's *text*, which
> would break deterministic `artifact` rendering and the offline `reasoner.run` test seam.

~~~mermaid
classDiagram
    class Responder {
        Mastra Agent, thinking-off, one generate
        +respond(turn) ChatEvents
    }
    class SendTool {
        Mastra createTool — all outbound
        +execute(text | tapback | richlink)
    }
    class DeliberateTool {
        Mastra createTool
        +execute(question) DeliberationResult
    }
    class Reasoner {
        own Mastra Agent, thinking-on
        +run(briefing, ctx, db) DeliberationResult
        -tools: update_facts, update_tasks, import_recipe
    }
    Responder --> SendTool : has (send)
    Responder --> DeliberateTool : has (deliberate)
    DeliberateTool --> Reasoner : execute calls run
~~~

The model decides *whether* to deliberate (social → skip, just `send`); the reasoner decides *what to
do* (runs its DB-mutating tools, returns a `DeliberationResult` the model then voices via `send`). A
**social turn** is a `send` with no `deliberate`; a **task turn** is `deliberate` then `send` — one
`generate` either way. (Increment 1: `send` collects `ChatEvent`s the Consumer delivers; increment 2:
`send` flushes + journals live. Same tool.)

**Responder context (lean, thinking-off):**
- Transcript (last N messages) with **member identity embedded** ("Alex: …").
- **Objective summary — two lines: what the objective is, and what the next step is.** Not
  the full task tree; that stays inside the reasoner.
- Knowledge it can `deliberate` (tool availability).
- `CHEF_VOICE` — personality, and when/how to respond (contextual acks, not every turn).

**Delegation (`deliberate`)** — the model calls the `deliberate` `createTool`, handing it a
natural-language task ("How should I move toward the objective?", "Does Alex like spicy food?").
The tool's `execute` invokes `reasoner.run`; the reasoner loads the active objective + eligible
tasks, runs its tool loop, and returns a structured **`DeliberationResult`** the model then voices by
calling `send`. The reasoner never sends — one mouth.

```ts
type DeliberationResult = {
  communicate: string[]    // points to convey — facts, confirmations, the upshot of deep thinking
  ask: string[]            // questions to advance the objective (0+)
  artifacts?: Artifact[]   // structured payloads too rich for a sentence
}
type Artifact = { kind: 'richlink'; url: string }   // extend: 'meal_plan', 'recipe_card', …
```

The responder **phrases** `communicate` + `ask` in `CHEF_VOICE`, and renders `artifacts`
deterministically through existing send paths (`richlink` → `sendLink`). The shape is
consistent every turn so the responder always knows what to expect — deeper results (a meal
plan) arrive as a new `Artifact.kind`, not a reshaped payload.

This keeps today's `ReplyPlan` shape but purpose-builds it for the inverted flow: `intents`
(used only for ack-detection) is dropped, because the front responder already decided to
react *before* invoking `deliberate` — so `deliberate` output is always substantive.
`must_say` becomes `communicate`; `ask` and `artifacts` are added. The front responder *is*
the render step.

---

# Tables

## messages (existing — one new column)

| Column Name | Type | Constraints | Notes |
|---|---|---|---|
| trigger_id | text | null, fk → messages.id | Inbound message id that caused this outbound row. Enables send-dedup and re-entry-state detection on redelivery. Null for legacy/greeting rows. |

Index `idx_messages_trigger` on `(thread_id, trigger_id)` for the re-entry lookup.

No new tables. No new domain entities (Objective, Task, Thread, Message unchanged).

---

# Testing

## Coverage

| Use Case | Type | Unit | Integration |
|---|---|---|---|
| F-01 conversational (no deliberate) | Flow | x | x |
| F-02 task (ack → deliberate → result) | Flow | | x |
| F-02 crash/resume | Flow | x | x |
| `deliberate` tool wraps reasoner | Op | x | |

## Approach

- **Unit.** Responder with a **stub `deliberate`** and stub `send` (records calls): assert a
  social message emits a reaction/short bubble and **never calls deliberate**; a task
  message calls `deliberate` once then sends. Stub reasoner for the deliberate-tool unit.
- **Integration.** Real `Consumer` + real Turso + stub `Sender` (records sends). Drive the
  crash/resume case by running the turn, killing it after the ack row commits, re-invoking
  `handle` on the same doorbell, and asserting **exactly one ack** and one result reach the
  sender. This is the load-bearing test — it proves the durability contract.
- **Reuse** the existing `chef-sim.ts` harness for an end-to-end sanity pass.

## Infrastructure

Extend the stub `Sender` to record ordered sends per `trigger_id` so the dedup assertion is
a one-liner. Everything else reuses existing fixtures.

---

# Deployment

## Migrations

| Order | Type | Description | Backwards-Compatible |
|---|---|---|---|
| 1 | schema | Add nullable `messages.trigger_id` + index | yes (nullable, old code ignores it) |

## Deploy Sequence

Single deploy. Migration is additive and safe to run before the code. Old rows have
`trigger_id = null` and are treated as "no prior send for any trigger" — harmless, since
the cursor already gates them.

## Rollback Plan

Behavioural change is code-only; revert the deploy to restore the reasoner-first pipeline.
The nullable column can stay (unused) — no down-migration needed.

---

# Monitoring

## Metrics

| Name | Type | Use Case | Description |
|---|---|---|---|
| chef_turn_deliberated | counter | F-01/F-02 | Turns that invoked `deliberate` vs not — measures how often we skip System 2 (the core win). |
| chef_time_to_first_send_ms | histogram | F-01/F-02 | Trigger → first outbound sent. Should drop to ~1-2s. |
| chef_double_send_dropped | counter | F-02 resume | Sends suppressed by `trigger_id` dedup — should be ~0; a spike means crashes are frequent. |

---

# Decisions

## D-01: Invert responder/reasoner instead of adding a reflex layer

**Framework:** Direct criterion — reuse over new machinery.

A third "reflex" model in front would work but adds a model to host, tune, and keep tonally
in sync. Inverting the two agents that already exist gives the same dual-process behaviour
(System 1 always on, System 2 on demand) with a smaller change, and yields **one voice**
(the responder speaks both the reaction and the reasoner's result), eliminating tone drift.

**Choice:** Responder is front-line with `send` + `deliberate` tools; reasoner becomes the
`deliberate` subagent.

### Alternatives Considered
- **Reflex model in front of the reasoner:** rejected — third model, two-voice drift, larger surface.
- **Keep reasoner-first, just let it chat:** rejected — doesn't remove the ~8-10s floor on social messages.

## D-03: Reasoner exposed to the responder via a `deliberate` `createTool` (not native sub-agents)

**Framework:** Direct criterion — preserve structured data + the offline test seam.

The original intent was Mastra's native sub-agent primitive (`agents: { reasoner }`). A pre-mortem
against the **installed** `@mastra/core@1.63.2` (compiled runtime + `.d.ts`, dispositive) showed
native delegation returns only the sub-agent's **text** to the supervisor — the delegation tool
calls the sub-agent's `generate` with no `structuredOutput` and hands back `{ text, finishReason }`;
`SubAgentGenerateResult` has no `object` field. That makes deterministic `artifact` rendering (the
`richlink` upshot) impossible — the supervisor would paraphrase a URL out of prose — and removes the
offline `vi.spyOn(reasoner,'run')` seam (delegation runs inside Mastra with no model offline).

**Choice:** Responder = one Mastra `Agent` (thinking-off) running **one agentic `generate`** with two
tools — **`send`** (the single outbound tool: text/tapback/richlink) and **`deliberate`** (a
`createTool` whose `execute` calls `reasoner.run(briefing, ctx, db)` and returns the real
`DeliberationResult`). The model acts only by calling tools; its `send` calls are the reply. Reasoner
stays its own Mastra `Agent` (thinking-on, owns the DB tools, keeps its MAX_ATTEMPTS / per-attempt
`buildTools` loop). Because `send` is a tool, **there is no `structuredOutput` and thus no
structured-output-vs-tool-call two-pass** — the earlier concern dissolves. Social = `send` only; task
= `deliberate` then `send`. Story 1 stays run-to-completion (one `ChefReply`, no Consumer/schema
change); mid-turn send + durability is the separate final increment (same `send` tool, evolved).

### Alternatives Considered
- **Native `agents: { reasoner }` delegation:** rejected — returns text-only; breaks deterministic artifact rendering and the offline test seam (evidence above).
- **Structured `{bubbles}` render pass (a second generation):** rejected — makes `send` a return value the code interprets, forces canned social replies, and reintroduces the two-pass gotcha. `send`-as-a-tool is simpler and lets the model author every reply.

### Documentation
- Mastra `createTool`: verified against installed `@mastra/core` (context7 `/mastra-ai/mastra`).
- Native-subagent limitation: `@mastra/core@1.63.2` `agent-*.js` `listAgentTools` / `subagent.d.ts`.

## D-02: Durability via `trigger_id` send-dedup, cursor advances last

**Framework:** Direct criterion — minimal state to make mid-turn sends resumable.

Incremental sends break the single-transaction turn. Rather than a turn-state machine table,
tag each outbound row with its `trigger_id`; re-entry state is derived from which rows
exist. Reasoner mutations are already idempotent upserts, so re-running `deliberate` is safe.

**Choice:** One nullable column; cursor stays the end-of-turn high-water mark.

### Alternatives Considered
- **Per-turn state table (fresh/acked/done):** rejected — more machinery than a derived flag needs.
- **Make ack + result atomic (one send at end):** rejected — that *is* today's behaviour; kills the responsiveness win.

---

# Open Questions

| ID | Question | Status | Resolution |
|---|---|---|---|
| Q-01 | Can the responder's `send` tool flush an outbound row *mid-generation* under the Mastra agent loop? | resolved | Mastra tools are plain functions; the `send` tool commits + sends when called. No buffering to work around. |
| Q-02 | Interruption: a message arrives while `deliberate` runs — restart or absorb? | resolved | Interruption stays exactly as today — the existing restart-on-interrupt barrier is preserved. |
| Q-03 | `deliberate` return shape. | resolved | Structured `DeliberationResult { communicate, ask, artifacts? }` — keeps the `ReplyPlan` shape (drop `intents`, rename `must_say`→`communicate`, add `ask`/`artifacts`). Consistent shape; richer results arrive as new `Artifact.kind`. See Modules. |

---

# Appendix A — Changelog

| Date | Author | Change |
|---|---|---|
| 2026-09-02 | Claude + Jordan | Initial draft |
| 2026-09-02 | Claude + Jordan | Resolved Q-01/02/03; defined `DeliberationResult` structure |
| 2026-09-02 | Claude + Jordan | D-03: reasoner is a Mastra sub-agent of the responder; collapse to one run-to-completion increment + one durability increment |
| 2026-09-02 | Claude + Jordan | Pre-mortem: native Mastra `agents:{}` returns text-only → D-03 revised to a `deliberate` createTool calling `reasoner.run`; task turn = 2 generations. Story-2 table corrected to `thread_messages` (libSQL/Turso). |
| 2026-09-02 | Claude + Jordan | Responder is agentic: ONE `generate` with ONE `send` tool (all outbound) + `deliberate`. No structured `{bubbles}` output → the two-pass gotcha dissolves; social replies are model-authored, not canned. |
