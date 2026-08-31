# Increment 2 — Reasoning & Onboarding: work items

The buildable specs for increment 2 of Harvest's iMessage onboarding, split into 8 work items.
Design source of truth: [`../../imessage-onboarding/increment-2-reasoning-and-onboarding.md`](../../imessage-onboarding/increment-2-reasoning-and-onboarding.md).
Substrate it builds on: [`../../imessage-onboarding/increment-1-substrate-and-response.md`](../../imessage-onboarding/increment-1-substrate-and-response.md).

The increment replaces the inc-1 stub chef with the real reasoning layer (objectives, a slot
scoreboard, validated command runners) and makes the household a first-class entity, so a household
can text the number and be guided through its whole cooking profile.

## Work items, in dependency order

| WI | Title | One-line summary | Depends on |
|---|---|---|---|
| **WI-01** | Objectives & slots schema + `ObjectiveStore` | The `objectives` + `slots` tables (stack + scoreboard) and the store that loads active + unfilled, pushes, applies slot updates under the "filled needs a landed write" invariant, and pops. | — |
| **WI-02** | Household schema + repos | `households`, `household_members`, `household_preferences`, `users.imessage_handle`; the migration backfilling one single-member household per user; `PreferenceService` for household + per-member read-merge-writes. | — |
| **WI-03** | Command runners (tools) | The Mastra tools — `save_household_profile`, `save_member_profile`, `search_catalog` — each a Zod-validated `createTool` with `canRun(state)` + an in-process service call returning a `SaveResult`. | WI-01, WI-02 |
| **WI-04** | Reasoning agent + briefing | The Mastra reasoning `Agent`, dynamic per-objective resident tools + `ToolSearchProcessor`, and `prepareBriefing` (L1/L2/L3); yields a `ReplyPlan` + slot updates, no prose. | WI-01, WI-03 |
| **WI-05** | Response agent | The Mastra response `Agent`: renders a `ReplyPlan` + transcript window into `ChatEvent`s (bubbles + tapbacks) under the fidelity rule; touches no data. | WI-04 |
| **WI-06** | Chef facade & consumer | `Chef.respond(threadId) → ChefReply \| null` loading its own context, running reasoning → response → the interruption barrier; `selectChef(db)`; the consumer commits `{chatEvents, slotUpdates, cursorTo}` in one tx behind the lock + typing wrap, importing only `Chef` + `selectChef`. | WI-01, WI-04, WI-05, WI-07 |
| **WI-07** | Onboarding objective | The `onboarding` `ObjectiveDefinition` — its slot list (household + per-member), condition-gated guidance (tastes drill-down, the allergy ladder), and the confetti-close completion. | WI-01, WI-03 |
| **WI-08** | Eval harness | The golden-transcript harness: scenario files (reference script, correction, proxy answer, conflict) replayed against real prompt + real tools + seeded `file:` db + a scripted model; asserts tool-call sequences + final DB state offline, plus a gated rubric judge. | WI-04, WI-05, WI-06, WI-07 |

## How they stack

All 8 work items stack on branch `jordangaston/imessage-increment-2` (based on the inc-1 PR
branch), built in the order above via `/implement-feature` — each WI's spec is picked up, the
dependencies it lists are already merged into the branch, and it lands its own commit(s). WI-01 and
WI-02 are independent and can start in parallel; WI-03 waits on both; WI-04→WI-05→WI-06 chain
through the Chef; WI-07 slots in alongside WI-04 (both need WI-01/03) and is required by WI-06's
real path; WI-08 lands last, exercising the whole assembled chef end to end offline.
