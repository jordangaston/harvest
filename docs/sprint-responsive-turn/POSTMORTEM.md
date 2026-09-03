# Responsive Turn — Sprint Post-mortem (live log)

Opened Phase 0. Appended throughout. Prime directive: after the (already-satisfied) clarify/design
gates, never stop — decide, log here, continue.

## Sprint inputs
- **Design (source of truth):** `docs/objective-system-v2/RESPONSIVE-TURN-DESIGN.md` (D-01, D-02, D-03; Q-01/02/03 resolved).
- **Story 1:** `specs/spec-01-responder-supervisor.md` — responder becomes a Mastra supervisor agent; reasoner becomes its sub-agent (`agents: { reasoner }`); one run per request; run-to-completion; no Consumer/schema change. Reshape `ReplyPlan` → `DeliberationResult`.
- **Story 2:** `specs/spec-02-midturn-send-durability.md` — mid-turn `send` tool + `messages.trigger_id` durability + crash/resume. Depends on Story 1. Highest risk.
- **Order:** 1 then 2.

## Phase 0 — Orient & environment

- Conventions read: root `CLAUDE.md`/`AGENTS.md`, `server/CLAUDE.md`. Note: `server/CLAUDE.md` still
  says DBOS + Postgres, but the live stack is Vercel Workflow + libSQL/Turso (memory
  `harvest-server-stack-current`; design doc says Turso). **Decision:** trust the live code, not the
  stale CLAUDE.md prose, for the DB layer — confirm the store by reading the actual Drizzle schema
  before the Story-2 migration.
- `main` already merged (fast-forward to `91b706b`); base branch `jordangaston/objective-system-v2-2`.
- Test runner: Vitest, run from `server/` (`pnpm exec vitest run`). Tests run offline (env-gate deletes `DEEPSEEK_API_KEY`).
- **Baseline suite (from Phase-1 Understand run):** 78 files pass / 1 fail; 578 tests pass / 2 fail / 1 skip.
  The 2 failures are `test/media.test.ts` (`ffmpeg-static` binary not downloaded — `spawn … ENOENT`),
  pre-existing and unrelated to the chef. **All chef tests pass.** These 2 are the accepted baseline —
  not regressions.
- Codebase mapped in prior discussion (chef.ts, reasoning-agent.ts, response-agent.ts, consumer.ts,
  types.ts, tools/registry.ts) — signatures captured in spec-01 §Background.

## Phase 2/3 — Clarify / design review
- **Skipped by instruction:** the user confirmed the clarify + design-review gates are satisfied by
  the design doc (Decisions + all Open Questions resolved). No AskUserQuestion batch, no design pause.

## Phase 4 — Specs
- Two specs written and copied under `specs/`. Grounded in the current post-merge code.

## Decisions log
- **D(sprint)-1:** Reasoner modeled as a Mastra sub-agent via `agents: { reasoner }` (design D-03),
  verified against live Mastra docs (context7 `/mastra-ai/mastra`, `docs/subagents.mdx`,
  `docs/agents/tools.mdx`). Delegation tool is auto-generated from the sub-agent's `description`.
- **D(sprint)-2:** Increments 1+2 of the original plan collapsed into Story 1 (one run-to-completion
  refactor); durability isolated as Story 2. Keeps the risky Consumer rework last.

## Phase 5 — Pre-mortem (folded)

Pre-mortem verified against installed `@mastra/core@1.63.2` (compiled runtime + `.d.ts`, dispositive). Findings:

- **P0-1 (design-invalidating): Mastra native `agents:{}` delegation returns only the sub-agent's
  TEXT, not its `structuredOutput`.** Evidence: the delegation tool calls `resolvedAgent.generate(...)`
  with no `structuredOutput` and returns `{ text, finishReason, ... }`; `toModelOutput` collapses to
  `{type:'text'}`. `SubAgentGenerateResult` type has no `object` field. → `DeliberationResult`
  (`communicate`/`ask`/`artifacts`) cannot survive delegation; deterministic `richlink` artifact
  rendering (design line 176) is impossible; the offline `vi.spyOn(reasoner,'run')` seam disappears.
  **This breaks D-03 as specified.**
- **P0-2: structuredOutput on the supervisor + a delegation tool-call in one generation = the known
  tools-vs-structured two-pass gotcha** on DeepSeek+jsonPromptInjection. → keep the proven
  two-generation reasoner→render split; the literal "collapse to one model call" is not viable for
  task turns.
- **P0-3: offline test seam undefined** — native delegation is a runtime LLM behavior; scripted
  doubles can't delegate without a model. Fixed by P0-1's tool approach (keeps `reasoner.run` seam).
- **P0-4: Story 2 table/stack corrected** — no `messages` table; it's **`thread_messages`**
  (`src/schema.ts:199`), stack is **libSQL/Turso** (`drizzle-orm/libsql`, `dialect:'turso'`), not
  Postgres. Column: nullable `trigger_id` + index `(thread_id, trigger_id)` via `drizzle-kit generate`.
  Tests migrate a real libSQL file (`test/helpers/migrated-db.ts`), so Story-2 TC5 is real for free.
- **P1-1:** live `MastraResponder` render forces `bubbles.min(1)` → an empty `DeliberationResult`
  would still emit a bubble, breaking AC-4. Fix: short-circuit render to `[]` on empty plan.
- **P1-2:** the reshape drops `intents`/`address`, which today's tapback grounding rule needs → move
  the react/tapback decision into the supervisor's social branch (it holds `triggerExternalId`).
- **P1-4:** social turns must pass `confirmTasks: []` explicitly (not inherit `loadTurn`'s list), or a
  social bypass could spuriously confirm/pop tasks the reasoner never advanced.

**DECISION (user-confirmed):** Expose the reasoner via a hand-rolled Mastra `deliberate` `createTool`
(its `execute` calls `reasoner.run`, returns the real `DeliberationResult`); keep the two-generation
reasoner→render split for task turns (social turns = one render call, reasoner untouched). Reasoner
stays its own Mastra Agent; we control the return shape and keep the `reasoner.run` offline spy seam.
Native Mastra `agents:{}` delegation is NOT used (text-only return breaks artifacts + testability).
Design D-03 + spec-01 updated to match. Folding all P0/P1 fixes into spec-01/spec-02.

## Phase 6 — Implement Story 1

- Implementer built the approved two-generation `deliberate`-createTool version (commits `0f2cbf7`
  → `b189323`); full suite green (582 pass, 2 pre-existing media fails). Coordinator verified: tsc
  clean, Consumer untouched, diff faithful.
- **Coordinator review caught a product-quality gap:** the built version reduced ALL social turns to
  a fixed ❤️ tapback (or the canned string `"love it!"`) — the model's warm text was discarded. The
  motivating example ("I know right! Bang for your buck 😁") was impossible. Surfaced to user.
- **User course-correction (authoritative):** the responder is **agentic** — ONE `generate` call with
  ONE `send` tool (covers text, tapback, richlink; threaded replies + cards later) plus `deliberate`.
  The MODEL chooses via tool calls; no structured `{bubbles}` output, no gen-1/gen-2 render split, no
  canned strings, no return-value-to-send-later. Social reply and deliberated reply use the SAME
  `send` tool — the only difference is whether `deliberate` ran first.
  - **Key insight:** making `send` a tool DISSOLVES the P0-2 structured-output-vs-tool-call two-pass
    gotcha entirely — there's no structured output to conflict with tool calls. The whole two-pass /
    createTool-return-value scaffolding was unnecessary.
- **Rebuilt (coordinator, this session):** `response-agent.ts` — `MastraResponder` is one Mastra
  `Agent` with `{ send, deliberate }` tools; `send`'s execute collects `ChatEvent`s (increment 1
  accumulates; increment 2 will flush+journal — same tool). `deliberate` takes a `question`, threaded
  into the briefing (`briefing.ts` + `chef.ts` thunk). `sendEvent()` grounds a tapback only on the
  real trigger id (AC-7: never a bogus target; the model sends text when there's none).
  `ScriptedResponder({ deliberate?, send? })` keeps the offline `reasoner.run` spy seam.
- Verified: tsc clean; `chef-response` (9) + `chef-reasoning` (6) + `chef-onboarding` (13) +
  `imessage-consumer-logic` (16) = **44 pass**. Full-suite confirmation in progress.
- **Design doc + spec-01 to reconcile** to the send-tool model (they still describe the two-gen
  structured render — now superseded). Pending after suite confirmation.

## Phase 6 — Implement Story 2 (mid-turn send + durability)

- Story 1 committed: `22ee3f8` (agentic responder) + `14d6176` (docs). Full suite green (baseline).
- **Schema increment DONE + committed `5be93b5`:** `thread_messages.trigger_id` + `(thread_id,
  trigger_id)` index; migration `0035`. Applies against the libSQL test db; 31 integration tests green.
- **Durability approach (user-confirmed): deterministic-guid dedup.** Each send's
  `message_guid = ${triggerId}#${ordinal}` → onConflictDoNothing on the unique index dedupes a
  redelivery replay; cursor advances last. Ceiling: divergent re-run after a mid-turn crash may
  drop/misorder the tail (rare, no data loss). Reframed by a find: the **current** code already
  documents a double-send-on-crash ceiling (`sender.ts:81`) — deterministic-guid is strictly better.
- **Two delicate interactions found & folded into spec-02:** (a) the **interruption barrier** must
  drop its restart — live sends aren't discardable (Q-02 resolved in practice: the drain loop picks up
  mid-turn messages next iteration); (b) **greet confetti** rides the first live send via the sink.
- **Design authored into `specs/spec-02` (Implementation design section):** the `OutboundSink`, the
  `chef.respond(threadId, sink)` contract change (`ChefReply` → `{confirmTasks, cursorTo, objectiveId,
  delivered}`), the Consumer rework (confirm/complete/cursor-last + post-turn effects), the load-bearing
  crash/resume test. Dispatched to implementer.

## Phase 6 — Story 2 verified (coordinator, independent)

- Implementer commits: `c0533d8` (OutboundSink + SupervisorTurn.send), `6833bcf` (Consumer sink,
  cursor-last), `64db21e` (crash/resume + trigger_id tests). Full suite (implementer): 586 pass.
- **Coordinator independent verification:** tsc clean; full suite re-run — only the 2 pre-existing
  `media.test.ts` ffmpeg failures (no regressions). Read the Consumer `LiveOutboundSink` (deterministic
  `${triggerId}#${ordinal}` guid, `insertOutboundIdempotent` onConflictDoNothing + `alreadySent`
  skip, cursor advances LAST, greet-confetti on first live text, post-turn effects preserved) and the
  load-bearing crash/resume test (TC2) — both correct. Verified, not relayed.

## Phase 7 — Demo (LIMITATION, logged)

- **No live demo possible in this environment.** The real path needs `DEEPSEEK_API_KEY` (the model's
  social-vs-deliberate judgment + voice) and a Spectrum/iMessage runtime (`PHOTON_*` creds); offline,
  the env-gate selects the scripted doubles. The unit + integration suite is the proof of *wiring*;
  the model's *judgment* (does it bias-to-deliberate, does the ack feel natural, does it pick
  tapback-vs-warm-reply well) is **unverified**. This is the standing caveat from both stories.
- Recommended live check before ship: run the `chef-sim` harness (or a real thread) with a key and
  walk the scripted scenarios (social → tapback/warm line, no deliberate; task → ack → deliberate →
  result; crash mid-turn → no double-text).

## Follow-ups before ship
1. **Bubble reordering (regression, Story 2).** Live per-bubble sends replaced the ordered batch that
   `dispatch` used to prevent iMessage reordering rapid sends (`sender.ts:81` documents the reorder
   bug). A turn emitting 2+ text bubbles back-to-back can reorder client-side. Mitigated (CHEF_VOICE
   prefers one message; ack/result separated by deliberation) but real. Fix if it surfaces: buffer
   consecutive same-kind sends in the sink and flush as one batch (needs a flush signal).
2. **Live judgment unverified** (Phase 7) — run a keyed demo before ship.
3. `ONBOARDING_CLOSE` is now effectively dead product code (reshaped, not deleted) — candidate removal.
4. `server/CLAUDE.md` still says DBOS/Postgres; stack is libSQL/Turso — correct the doc.

## Blockers / quota gaps / skips
- Phase 7 live demo skipped — no DEEPSEEK/Spectrum creds in this env (logged above). Not a blocker to
  code-completion; is a blocker to "shippable" until a keyed demo runs.
