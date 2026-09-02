# WI-3: Model tools + integration

> Design source of truth: `docs/objective-system-v2/DESIGN.md`. Depends on WI-1 (tasks) and WI-2
> (facts/`writeFact`).

## Background

WI-1 gives us `tasks`; WI-2 gives us facts + `writeFact`. This work item exposes the model-facing
surface and rewires the turn. The bespoke `save_*` JSON tools collapse into a uniform fact surface,
slot-fill moves from a post-turn structured-output reconciliation (the fragile
`reconcileSlotUpdates` / `key.split('.').pop()` matching in `reasoning-agent.ts`) to in-loop tool
calls, and the onboarding objective is redefined in terms of tasks.

## Objective

Ship the four model tools, rewire reasoning/briefing/consumer, redefine the onboarding objective as
tasks, and delete the superseded tools — so a real onboarding conversation runs end to end on v2.

## Acceptance Criteria

1. **Tools.** Four `ChefTool` classes, wired in `tools/registry.ts`:
   - `read_facts(keys?)` → known fact values (all if no keys).
   - `fact_types(fact_type?, query?)` → the 2×2 (browse/describe/ground/search) with a `kind`-tagged,
     `page_token`-paged response; folds in today's `search_catalog` grounding.
   - `update_facts(updates:[{key,value,member_user_id?}])` → out-of-band writes via `writeFact`;
     advances no task; rejects `derived` facts.
   - `update_tasks(updates:[{task_id,value}])` → resolves each task → fact/fact_type, routes through
     `writeFact`, sets the task `filled` on success; returns per-task status + `objectiveComplete`.
     Batches eligible tasks; `solo` tasks are asked alone.
2. **Reasoning.** `ReasoningOutput` no longer carries `slotUpdates`; task fills happen through the
   in-loop `update_tasks`/`update_facts` tools inside the turn transaction. `reconcileSlotUpdates` and
   the suffix-matching are deleted. `MAX_STEPS` raised toward ~10 to fit batched fills (Q-05).
3. **Briefing.** `prepareBriefing` renders the objective's **eligible** tasks with their `[id]`,
   marking `solo` and gated ones, and instructs the model: address objective work with `update_tasks`
   by `[id]`; record an out-of-band fact with `update_facts` by key; discover types via `fact_types`.
   The old slot rendering and `save_*` conduct are removed.
4. **Emit / ack confirmation.** An `emit` task is marked `filled` at **send-time** — when the outbox
   confirms its bubbles went out — then the consumer runs `isComplete`/`completeAndPop` (revised
   Q-02); no lingering, no substring matching. The explainer-ack is a separate `elicit` (no domain
   fact, `solo`, gating the rest) confirmed by the user's **next inbound** (the reply is the ack).
5. **Onboarding redefined.** The onboarding objective is expressed as tasks: one `elicit` explainer-ack
   (`solo`, gating the rest), the profile `elicit` tasks (typed per WI-2), and the close as a required
   `emit` gated `after` all required elicits (generalizes `ONBOARDING_CLOSE`). Member tasks
   instantiate per identified member.
6. **Household creation.** The household is created on the first inbound message (code), not by a model
   tool; `create_household` is removed.
7. **Deletions.** `save_household_profile`, `save_household_goals`, `save_member_profile`,
   `create_household`, `search_catalog`, and `models/slot.ts` are removed; nothing imports them.
8. **Green + demo.** All suites pass; a scripted-reasoner onboarding run (no network) drives
   `update_tasks`/`fact_types` and reaches the close with every required task terminal.

## Test Cases

### TC-1: `update_tasks` fills and advances
**Preconditions:** active onboarding objective; grocery-store catalog seeded.
**Steps:** model grounds via `fact_types('GROCERY_STORE','trader joes')`, then
`update_tasks([{task_id, value:<canonical>}])`.
**Expected:** value persists to `grocery_stores`; task → `filled`; response reports the fill and
`objectiveComplete:false`.

### TC-2: `update_tasks` instructive rejection in-loop
**Preconditions:** active objective; allergen task for member M.
**Steps:** `update_tasks([{task_id:<M.allergens>, value:{value:'peanuts'}}])` (no severity).
**Expected:** `{status:'rejected', missing:[severity,confirmed]}`; task stays non-terminal; the model
can retry the same turn.

### TC-3: `update_facts` out-of-band
**Preconditions:** thread with **no** active objective (or a fact no task tracks).
**Steps:** `update_facts([{key:'member.allergens', value:{...valid}, member_user_id:M}])`.
**Expected:** persists via `writeFact`; no task advances; `objectiveComplete` absent/false.

### TC-4: `fact_types` 2×2
**Preconditions:** seeded catalogs.
**Steps:** call with (none), (`GROCERY_STORE`), (`'costco'`), (`GROCERY_STORE`,`'costco'`).
**Expected:** browse list; describe with values/rule; cross-type ranked matches; single-type search —
each response `kind`-tagged; large types paged with `page_token`.

### TC-5: emit close confirmed next signal
**Preconditions:** onboarding with only the close `emit` left, all required elicits filled.
**Steps:** turn N delivers the close; turn N+1 a user reply arrives.
**Expected:** turn N sends the close, objective still active; turn N+1 marks the emit `filled`,
`isComplete` true, objective pops.

### TC-6: full scripted onboarding
**Preconditions:** `ScriptedReasoner` plan covering the flow; local libSQL (migratedFileDb).
**Steps:** run the onboarding conversation end to end.
**Expected:** explainer-ack asked first and alone; every required task reaches terminal; the close
fires; no reference to deleted tools; suite green.

## Deployment Strategy

Ships together with WI-1's migration and WI-2's registries. Pre-GA, only-us — deploy code + migration
together; no flag. Rollback = revert the branch + down-migration.

## Production Verification

### PV-1: Real onboarding turn on v2
**Preconditions:** deployed with `DEEPSEEK_API_KEY`; a test iMessage thread.
**Steps:** run the onboarding flow via the existing e2e harness; drop a fact out of band.
**Expected:** facts persist to domain tables through `writeFact`; tasks advance; the close fires and
the objective pops on the following inbound; the out-of-band fact is captured with no active task.
