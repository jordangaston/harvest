# Merge the reasoner and responder into one agent

**Status:** design for the implementer. Short by intent — this is mostly deletion.

## Why

The chef is currently two agents: a **reasoner** (thinking-on, owns the DB tools, emits a
`DeliberationResult`) invoked through a `deliberate` tool by a **responder** (thinking-off, owns the
`send` tool and voice). The split hands facts across a lossy `{communicate, ask}` interface: the
reasoner decides without owning tone, the responder voices facts it didn't derive and can only say
what's in the struct. It also costs a responder→deliberate(two-phase)→responder round-trip per turn.

Collapse them into **one agent** that reads the message, holds the objective, calls the tools, and
speaks — full context on both sides. This also **removes the structured-output latency bug**: a single
agent that outputs through the `send` tool has *no* structured output, so the tool-loop-vs-structured
two-pass (the `object undefined` retries) can't happen. The two-phase reasoner becomes unnecessary.

We start merged and only re-split if a single prompt is *proven* unable to hold both jobs.

## The single agent

One Mastra `Agent` (`deepseek/deepseek-v4-flash`), **thinking ON at LOW effort**.
`[VERIFY: the exact knob — providerOptions `{ deepseek: { thinking: { type: 'enabled' } } }` plus a
reasoning-effort/budget if DeepSeek exposes one; check ctx7 `/deepseek` + installed @mastra/core. If
there is no granular "low", use thinking enabled and flag it.]` Low keeps decision quality (thinking-off
once conflated household members) while capping the think cost.

- **Tools:** the active objective's reasoning tools via the existing `buildTools(ctx, db, def.tools)`
  (`update_tasks`, `update_facts`, `read_facts`, `fact_types`, `create_household`, `import_recipe`) —
  **plus** the `send` tool (text/tapback/richlink), which flushes live through the Consumer's sink.
- **No `structuredOutput`.** Output is *only* `send` calls. This is the point.
- One `generate` per turn with `stopWhen: steps >= MAX_STEPS`.

## Turn flow (one loop)

1. Read the newest message against the objective + transcript.
2. **Purely social / no work** → `send` a tapback or one warm line. No tools. Done.
3. **Bears on the objective** → `send` a brief warm ack FIRST (as the first action), then call the
   persist tools (`update_tasks`/`update_facts`/…), then `send` the result: confirm what landed and
   ask the next question, warmly.
4. Preserve every fact exactly (severe allergy = severe); never invent a value the tools didn't return.

## Prompt

Merge three sources into ONE system prompt: the reasoning conduct + `HARD_RULE` from `briefing.ts`
(`CONDUCT_AND_SAFETY`), the `CHEF_VOICE` persona from `response-agent.ts`, and the social-vs-work +
ack-first rules. The briefing *body* (objective, tasks, members, transcript, trigger) stays as the
turn input via `prepareBriefing`.

## Delete

- `reasoning-agent.ts` (`MastraReasoner`/`ScriptedReasoner`/two-phase), the `Reasoner` interface.
- The `deliberate` `createTool` and the `SupervisorTurn.deliberate` seam.
- `DeliberationResult` / `ReasoningOutput` types (and their handoff plumbing).

## Keep unchanged

- **The Consumer + `LiveOutboundSink`** — `trigger_id` deterministic-guid durability, cursor-last,
  redelivery dedup. The merged agent still sends via the sink; the transport is untouched.
- `briefing.ts` assembly (now the single agent's input), the objective/task/fact/tool layer.

## `chef.ts` wiring

`respond(threadId, sink)` builds ONE agent — objective tools + a `send` tool bound to `sink.send` —
and runs it. Replaces the responder+reasoner dance.

**Confirm-tasks gate:** today `confirmTasks` fires when the turn `deliberated`. Merged, that becomes
"did the agent call a mutating tool this turn?" A `send`-only (social) turn → `confirmTasks: []`; a
turn that called `update_*`/`create_household`/etc → confirm the fact-less tasks as before. Track a
`worked` flag (set when any mutating tool runs) and return it in place of `deliberated`.

## The one risk to watch (thinking-on + ack ordering)

A thinking model front-loads reasoning, so the "quick ack" may not reliably precede the heavy think
the way today's fast responder→slow reasoner does. Instruct "send the ack as your FIRST action," then
**measure live**: if the ack still lands only after the think, log it as a finding — don't pre-build a
cheap thinking-off ack pre-pass until it's proven necessary.

## Offline seam + verification

- Replace `ScriptedReasoner`/`ScriptedResponder` with one scripted agent double (records tool calls +
  sends; drives the `sink`). Reconcile `chef-response`/`imessage-consumer-logic`/`chef-reasoning`/
  `chef-onboarding` tests to the single-agent shape. Keep the `worked`/social assertions.
- **Green bar:** tsc clean; full suite passes except the 2 pre-existing `media.test.ts` ffmpeg fails.
- **Live:** reset a fresh household and run the real iMessage onboarding; compare voice quality,
  latency, and ack timing against the split (the current PR #80 baseline).

## Out of scope (do not fix here)

The early-completion bug (`isComplete` fires early → `completeAndPop` pops onboarding mid-flow →
re-seed) is separate — flag it, don't fold it in.
