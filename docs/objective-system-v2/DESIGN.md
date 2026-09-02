---
tags: [imessage, objectives], tdd
summary: "Objective system v2 — facts, tasks, and the fact-type registry"
locked: false
---

# Objective System v2 — Facts, Tasks, Fact Types

Rework the objective system so it can reliably drive well-defined, long-running tasks. Three
moves:

1. **Split the conflated `slot`** into a **fact** (a typed datum about a household/member —
   objective-independent, a view over the SQL domain tables) and a **task** (an objective's
   *pursuit* of something — an `elicit` task points at a fact; an `emit` task delivers information).
   Pursuit state (`unasked/asked/filled/defaulted`) moves off the fact and onto the task; the fact
   is just known/unknown + value.
2. **Two write verbs, split by objective-tiedness** (clearer for the model, and continuous with
   today's id-addressed slot updates): **`update_tasks`** for anything the active objective tracks
   (address the task by the `[id]` in the briefing) and **`update_facts`** for out-of-band facts
   nothing is tracking (address by key). Both are thin fronts over one internal `writeFact()`
   chokepoint that validates against the fact's type, instructively rejects, and persists to the
   domain table — so validation happens exactly once. Reads/discovery: `read_facts`, `fact_types`.
3. **Keep completion in code.** The model *proposes* (fills tasks, delivers emits); only code
   *completes* (`isComplete` over required tasks → `completeAndPop`). The model never declares an
   objective done.

Deferred (out of scope, no caller yet): time-based expiry/timers, terminal `failed`/`expired`
objective states, model-driven objective lifecycle (push/abandon), a generic action tool, `emit`
triggers beyond "on completion".

---

# Reviews

| Reviewer | Status | Feedback |
|---|---|---|
| Jordan Gaston | in_progress | |
| Architect | not_started | |

---

# Use Case Implementations

## Fill an `elicit` task inside an objective — Implements F-A

The model addresses the task by the `[id]` it sees in the briefing (as today). `update_tasks`
resolves the task → its `fact` + `fact_type`, routes through `writeFact`, and advances the task.

~~~mermaid
sequenceDiagram
    participant M as Reasoning model
    participant FT as fact_types tool
    participant UT as update_tasks tool
    participant WF as writeFact (chokepoint)
    participant DB as Domain tables
    participant OR as ObjectiveRepository

    rect rgb(240,248,255)
    note over M,FT: Ground the value (catalog-backed types only)
    M->>FT: fact_types(fact_type="GROCERY_STORE", query="trader joes")
    FT-->>M: matches + fact_type
    end

    rect rgb(255,248,240)
    note over M,OR: Fill + auto-advance
    M->>UT: update_tasks([{taskId, value}])
    UT->>OR: resolve task → fact, fact_type
    UT->>WF: writeFact(fact_type, subject, value, tx)
    alt invalid
        WF-->>UT: reject(reason, missing, closest)
        UT-->>M: {taskId, status: rejected, reason, closest}
    else valid
        WF->>DB: persist(subject, normalized, tx)
        WF-->>UT: ok
        UT->>OR: set task filled
        OR-->>UT: {objectiveComplete}
        UT-->>M: {taskId, status: filled, objectiveComplete}
    end
    end
~~~

`isComplete` → `completeAndPop` runs in the turn's commit transaction.

## Deliver an emit task (the onboarding close) — Implements F-B

`ONBOARDING_CLOSE` becomes an `emit` task, `required`, gated `after` every required `elicit`. When
the last elicit fills, the emit becomes eligible and the model **delivers** it via the reply plan.
The model does **not** mark it done — per Q-02, code marks the emit `filled` on the **next signal**
(a user reply, or a timer fire once built) by observing its content in the transcript. Completion
therefore may lag one signal: the objective pops when the emit is confirmed, not when it is sent.

~~~mermaid
sequenceDiagram
    participant M as Reasoning model
    participant R as Response layer
    participant C as Consumer

    note over M,R: Turn N — deliver
    M->>M: last elicit filled → emit eligible
    M->>R: replyPlan intents (the close)
    R-->>C: chatEvents (bubbles) sent

    note over M,C: Turn N+1 — next signal (reply or timer)
    C->>C: emit content present in transcript → mark emit filled
    C->>C: isComplete? → completeAndPop
~~~

## Out-of-band fact write — Implements F-C: user volunteers a fact no task tracks

`update_facts([{key, value}])` routes straight through `writeFact` — validate, persist domain table —
and advances no task (`objectiveComplete: false`). Works with or without an active objective. The
household's knowledge is captured regardless.

---

# Entities

~~~mermaid
classDiagram
    class Objective {
        +string definition
        +Status status
        +int stackPosition
    }
    class Task {
        +Kind kind
        +string fact
        +string factType
        +Scope scope
        +bool required
        +Status status
        +bool solo
        +string[] afterTaskIds
    }
    class ObjectiveDefinition {
        +string id
        +string instructions
        +string[] tools
        +TaskSpec[] tasks
    }
    class FactDef {
        +string key
        +string description
        +string factType
        +Scope scope
        +Access access
    }
    class FactType {
        +string name
        +Flavor flavor
    }
    Objective "1" --> "*" Task : tracks
    ObjectiveDefinition "1" --> "*" TaskSpec : declares
    Task ..> FactDef : references (elicit)
    FactDef ..> FactType : typed by
~~~

A **Fact** is not a table — it is a `FactDef` (flat-file definition) whose *value* lives in an
existing domain table, reached through its `FactType`. `FactType` and `FactDef` are code registries,
not persisted rows. `afterTaskIds` is a task's ordering gate: the task is eligible only when every
listed task is terminal (computed in code over the objective's loaded task set — no extra query).

---

# Tables

## `tasks` (replaces `slots`)

No production data exists (Q-03), so this is a **destructive replace**, not a rename+backfill: drop
`slots`, create `tasks`.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | uuid | pk | |
| objective_id | uuid | not null, fk → objectives | cascade delete |
| kind | text | not null | `elicit` \| `emit` |
| fact | text | null | fact key for `elicit`; null for `emit` |
| fact_type | text | null | the fact's type name; null for `emit` |
| scope | text | not null | `household` \| `member` |
| member_user_id | uuid | null, fk → users | set for member-scoped |
| required | bool | not null | completion waits only on required |
| status | text | not null, default `unasked` | `unasked/asked/filled/defaulted` |
| solo | bool | not null, default false | must be pursued alone (serial) |
| after_task_ids | text (json) | not null, default `[]` | ordering gate; array of task ids |
| follow_ups_sent | int | not null, default 0 | |

Indices: `unique(objective_id, fact, member_user_id)` (elicit dedupe; `emit` rows have null `fact`),
`index(objective_id, status)`. `after_task_ids` is a JSON array (SQLite/libSQL `text` json mode) — no
FK integrity on the ids; the objective push resolves definition task-keys → row ids and eligibility
is computed in code, so a dangling id fails closed (task stays gated). `objectives` is unchanged.

---

# Modules

~~~mermaid
classDiagram
    class FactType {
        <<interface>>
        +describe() TypeDoc
        +validate(value) Result
        +normalize(value) unknown
        +search(query, pageToken) ValuePage
        +persist(subject, value, tx) void
        +read(subject) unknown
    }
    class FactTypeRegistry {
        +get(name) FactType
        +list() TypeSummary[]
    }
    class FactRegistry {
        +get(key) FactDef
        +list() FactDef[]
    }
    class WriteFact {
        +writeFact(factType, subject, value, tx) WriteResult
    }
    class ObjectiveRepository {
        +loadActive(threadId) ActiveObjective
        +applyTaskUpdates(updates, tx) TaskResult[]
        +completeAndPop(objectiveId, tx) Objective
        +isComplete(objectiveId, tx) bool
    }
    class UpdateTasksTool
    class UpdateFactsTool
    class FactTypesTool
    class ReadFactsTool

    UpdateTasksTool --> WriteFact
    UpdateTasksTool --> ObjectiveRepository
    UpdateFactsTool --> WriteFact
    WriteFact --> FactTypeRegistry
    WriteFact --> FactRegistry
    FactTypesTool --> FactTypeRegistry
    ReadFactsTool --> FactRegistry
    ReadFactsTool --> FactTypeRegistry
    FactTypeRegistry --> FactType : holds
~~~

**`writeFact` is the single chokepoint** both write tools front: validate → normalize → instructive
reject or persist to the domain table. **`FactType` is static + dynamic** — static `name`/`flavor`
(`enum`/`catalog`/`scalar`)/description; dynamic `search`/`read` may hit the DB or a catalog service
to enumerate or ground values on demand. Enum/scalar types are pure flat-file; catalog types carry a
live provider.

~~~mermaid
flowchart LR
    M[model] -->|taskId,value| UT[update_tasks]
    M -->|key,value| UFa[update_facts]
    UT --> WF[writeFact]
    UFa --> WF
    WF -->|validate| FTR[FactTypeRegistry]
    WF -->|persist| DOM[(domain tables)]
    UT -->|advance task| OR[ObjectiveRepository]
    OR -->|completion| UT
~~~

---

# Tool Contracts

Model surface: two write verbs (split by objective-tiedness), two read/discovery verbs, plus existing
actions (`import_recipe`; more added when needed). `create_household` removed (household created on
the first message); `search_catalog` folded into `fact_types`.

## `update_tasks` — objective work, addressed by task id
`update_tasks(updates: [{ task_id, value }]) → { results: [{ task_id, status: 'filled' | 'rejected',
reason?, missing?, closest? }], objectiveComplete }`. Fills `elicit` tasks the active objective
tracks. Resolves each task → `fact`/`fact_type`, routes through `writeFact`, sets the task `filled` on
success. Batch multiple eligible tasks in one call (see Q-05); `solo` tasks must be sent alone. Emit
tasks are delivered via the reply plan and confirmed by code (Q-02), not marked here.

## `update_facts` — out-of-band, addressed by key
`update_facts(updates: [{ key, value, member_user_id? }]) → { results: [{ key, status }] }`. For facts
**no** active-objective task tracks. Same `writeFact` path; advances no task. Rejects a write to a
`derived`/read-only fact (Access). Objective-optional.

## `read_facts`
`read_facts(keys?: string[]) → { facts: [{ key, value, known: bool }] }`. No `keys` → all known facts.

## `fact_types(fact_type?, query?)`
One tool, two optional params — the 2×2 window into the type system; response carries a `kind` tag.

| `fact_type` | `query` | behavior | returns |
|---|---|---|---|
| — | — | browse | `[{ name, flavor, description }]` |
| set | — | describe | `{ name, flavor, values?[] \| rule, pageToken? }` |
| — | set | ground loose value | `[{ value, fact_type, score }]` (ranked, cross-type) |
| set | set | search one type | `[{ value, label }]`, `pageToken?` |

Paging uses `page_token`. `describe`/`search` enumerate only `enum`/`catalog` types; `scalar` returns
its `rule`. The tool steers the model to pass `fact_type` when known (`query`-only is the expensive
cross-type fallback).

---

# Testing

| Use Case | Type | Unit | Integration |
|---|---|---|---|
| F-A fill an elicit task | Flow | | x |
| F-B deliver emit / close (+ next-signal confirm) | Flow | | x |
| F-C out-of-band write | Flow | x | x |
| `writeFact` chokepoint | Op | x | |
| `FactType.validate/normalize` | Op | x | |
| `fact_types` 2×2 modes | Op | x | |
| `ObjectiveRepository` (tasks, gates) | Op | x | |

- **Unit:** each `FactType` handler in isolation; `writeFact` reject→instructive-reason and
  success→persist; `update_tasks` task-resolution + advance; `fact_types` mode selection; gate
  eligibility over a loaded task set; `isComplete`/`completeAndPop` over mixed elicit+emit required
  tasks; emit next-signal confirmation.
- **Integration:** `update_tasks` end-to-end against local Postgres (domain write + advance +
  completion in one tx); the `tasks` schema created by the test harness.
- **Reuse** the scripted-reasoner path (no network) to drive tool sequences.

---

# Deployment

## Migrations

| Order | Type | Description | Backwards-Compatible |
|---|---|---|---|
| 1 | schema | Drop `slots`; create `tasks` (destructive — no production rows, Q-03) | n/a |

No data migration. Pre-GA, so migrate + deploy together. **Rollback:** revert code + down-migration
(drop `tasks`, recreate `slots`); nothing to preserve.

---

# Decisions

## Split `slot` into `fact` + `task`
**Framework:** Direct criterion — single responsibility. The old `slots` row conflated the
household's *knowledge*, the objective's *pursuit state*, and *ownership*. Splitting lets facts be
objective-independent (out-of-band writes, `read_facts` memory) and lets one fact serve many
objectives. **Alternatives:** keep `slots` + bolt on columns — rejected; entrenches the conflation
and blocks objective-independent reads.

## Route writes by objective-tiedness (`update_tasks` vs `update_facts`)
**Framework:** Binstack — top priority *model clarity*. The model already reports progress by task
`[id]` today, so "objective work → `update_tasks` by id; stray fact → `update_facts` by key" is a
clear, continuous rule. Both front one internal `writeFact`, so the single-chokepoint invariant
survives at the service layer even with two tools. **Alternatives:** one `update_facts` that
auto-advances bound tasks (magic, and switches the model off id-addressing it does well); hide writes
behind `fill_slot` (breaks out-of-band tool use).

## `writeFact` is the single validation/persist chokepoint
**Framework:** Direct criterion — enforce the invariant once, at the boundary every write routes
through. Both write tools delegate here; a future writer that bypasses it breaks the guarantee, so
new write paths must go through `writeFact`. In-loop instructive rejection replaces today's silent
post-turn downgrade; the fragile `key.split('.').pop()` reconciliation is deleted.

## Completion stays in code; the model never completes
**Framework:** Direct criterion — the model *proposes*, code *disposes*. `isComplete` over required
tasks is computable; a model-declared "done" reintroduces the unreliability this redesign removes.
Emit delivery is code-verified against the transcript on the next signal (Q-02).

## `FactType` = static metadata + dynamic provider
**Framework:** Direct criterion. Enum/scalar types are flat-file; catalog types (stores, ingredients,
the food-preference facets) are too large/live to enumerate statically, so the type is a class with a
dynamic `search`/`read`. One interface hides both. Food preferences are a single faceted
`FOOD_PREFERENCE` fact — one value over a `facet` (cuisine/dish_type/ingredient/food_category)
carrying two orthogonal axes, `sentiment` (taste like/dislike) and `target` (intent −1..+1, so a
food_category with a negative target is "eat less") — not an intent-named like/dislike split. Its
writes go through the targeted `PreferenceRepository.upsertFoodPref`, not the replace-all
`savePreferences` (which Settings still uses).

## One polymorphic `fact_types(fact_type?, query?)` tool
**Framework:** Fermi ROI — a 2×2 of two named params is self-documenting and keeps the surface small;
the mode-inference cost is bought back by the `kind`-tagged response. Two separate list/search tools
were near-equal for a larger surface.

---

# Open Questions

| ID | Question | Status | Resolution |
|---|---|---|---|
| Q-01 | Does every current onboarding fact have a domain-table home, so `tasks` can carry no `value`? Audit `save_household_profile`/`save_member_profile` columns vs. the fact list. | open | |
| Q-02 | Emit verification timing. | resolved | **Revised:** an `emit` is marked `filled` at **send-time** — when the outbox confirms its bubbles went out (code observes the send, not the model's word) — so the objective pops the same turn (no lingering close). The explainer-ack is a *separate* case: an `elicit` (no domain fact) confirmed by the user's **next inbound** (their reply = the acknowledgment), which gates the rest of onboarding. Content-substring matching is rejected as brittle. |
| Q-03 | Any production `slots` rows to preserve? | resolved | No — only we use this code. Destructive drop+recreate; no backfill. |
| Q-04 | Do we need terminal `failed`/`expired` objective states now? (Original vision: "loop until completed **or expired**.") | resolved | No — defer with expiry. Objectives stay `active`/`suspended`/`complete` for now. |
| Q-05 | `MAX_STEPS` with thinking-on vs. a step per `update_tasks` call. | resolved | Batch eligible tasks into one `update_tasks` call (`solo` excepted); raise `MAX_STEPS` toward ~10 if the budget is tight. |

---

# Appendix A — Changelog

| Date | Author | Change |
|---|---|---|
| 2026-09-01 | Jordan Gaston | Initial draft |
| 2026-09-01 | Jordan Gaston | Route writes by objective-tiedness (`update_tasks`/`update_facts` over `writeFact`); `after_task_ids` array; resolve Q-02/Q-03/Q-05; destructive migration |
| 2026-09-02 | Jordan Gaston | Collapse the `TASTE_LIKE`/`TASTE_DISLIKE` split into one faceted `FOOD_PREFERENCE` fact (sentiment + target axes); chef food-pref writes go through the targeted `upsertFoodPref` |
