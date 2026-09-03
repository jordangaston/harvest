# Responsive Turn — Sprint Report

**Goal.** Make the iMessage chef feel like a person, not a mechanical goal-pursuer: respond fast to
social messages, and acknowledge before deliberating on task messages — instead of running the ~6s
reasoner + tool loop on every message.

**Outcome.** Both stories code-complete, unit/integration-verified, committed. Live model behaviour
is **not** verified (no key in this env) — a keyed demo is the one gate remaining before "shippable".

## Stories → status → proof

| Story | Status | Proof |
|---|---|---|
| **1 — Agentic responder** (one `generate`, one `send` tool for all outbound + `deliberate`; the model chooses tapback vs warm reply vs deliberate; no structured output, no canned replies) | ✅ code-complete, verified | `22ee3f8` + docs `14d6176`. tsc clean; `chef-response`/`chef-reasoning`/`chef-onboarding`/`imessage-consumer-logic` green; full suite baseline. |
| **2 — Mid-turn send + `trigger_id` durability** (send flushes live so an ack ships before deliberation; deterministic-guid dedup survives queue redelivery; cursor advances last) | ✅ code-complete, verified | schema `5be93b5` (migration `0035`), `c0533d8`, `6833bcf`, tests `64db21e`. Load-bearing crash/resume test passes; full suite only the 2 pre-existing media fails. |
| **Live demo** | ⚠️ skipped | No `DEEPSEEK_API_KEY` / Spectrum creds in this env — model judgment + real iMessage delivery unverified. |

## What shipped

- The responder is now the front line: **one agentic Mastra `generate`** with a **single `send` tool**
  (text/tapback/richlink; threaded replies + cards slot in later) and a **`deliberate` tool** that runs
  the reasoner. Social messages never wake the reasoner; task messages ack → deliberate → reply.
- **Mid-turn live sends** with a durability contract: each send is journaled with `trigger_id` + a
  deterministic `${triggerId}#${ordinal}` guid; a redelivered re-run dedupes on the unique index;
  the cursor advances last, so a crash re-runs cleanly. The interruption-restart was removed (live
  sends aren't discardable; the drain loop absorbs mid-turn messages).

## What went well

- **The pre-mortem paid for itself.** It caught, against the *installed* `@mastra/core`, that native
  `agents:{}` sub-agent delegation returns text-only — which would have silently broken artifact
  rendering and the offline test seam. Verifying against the runtime, not the docs, was decisive.
- **Iterating the design with the founder mid-flight** turned a two-pass, canned-reply responder into
  a clean agentic one. Making `send` a tool dissolved the structured-output-vs-tool-call two-pass
  problem entirely — a case where the simpler design was also the more correct one.
- **The existing idempotency substrate carried Story 2.** The unique `message_guid` index + `sent_at`
  gate were already there; deterministic guids reused them, and it's strictly better than the
  status-quo double-send-on-crash ceiling the old batch send already documented.

## What to improve

- **I over-engineered Story 1 first** (a decide→structured-render two-pass with canned social
  replies), and the founder had to redirect twice before it became the one-tool agentic version.
  Lesson: when the user says "it's agentic," reach for tools-with-side-effects before return-value
  plumbing.
- **The written durability spec predated the agentic responder** — its tidy `fresh|acked|done`
  re-entry model didn't survive a non-deterministic re-run. Re-deriving it mid-sprint (deterministic
  guids) worked, but the design should have been reconciled to Story 1 before Story 2 was specced.

## Follow-ups before ship (see POSTMORTEM)

1. **Bubble reordering** — live per-bubble sends dropped the ordered batch that prevented iMessage
   reordering; a 2+-bubble burst can reorder. Buffer+flush consecutive sends in the sink if it bites.
2. **Live judgment unverified** — run a keyed `chef-sim` (or real thread) demo.
3. Dead `ONBOARDING_CLOSE`; stale `server/CLAUDE.md` (says DBOS/Postgres; stack is libSQL/Turso).
