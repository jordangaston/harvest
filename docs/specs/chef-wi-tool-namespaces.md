# WI — Namespace the chef tool ids (`namespace__verb`)

## Background

The chef's tool surface is flat (`read_facts`, `update_tasks`, `import_recipe`, …) and about to
double with the meal-planning tools (`generate`, `slot_options`, `add_recipe_to_slot`,
`remove_recipe_from_slot`). A namespace prefix groups the surface for the model and for us.

The separator is **double underscore** (`facts__read`), not a colon: tool names pass the model
provider's function-name validator, and the portable set across providers (OpenAI-compatible,
Anthropic, Gemini) is `^[a-zA-Z0-9_-]{1,64}$` — no colon. This chef has already moved
DeepSeek → Groq → Gemini, so names must not bet on one provider's permissiveness. `__` is the
same convention MCP uses (`mcp__server__tool`).

Tool ids appear in three places that must move in lockstep: the `FACTORIES` registry
(`server/src/chef/tools/registry.ts`), each objective definition's `tools: [...]` list, and —
easy to miss — **prose that names tools inline**: the system prompt (`CHEF_PROMPT` in
`chef-agent.ts` names `send`, `update_tasks`, `update_facts`, `fact_types`, `read_facts`,
`add_members`), task guidance strings in `objectives/onboarding.ts` (e.g. "Ground each store with
`fact_types(...)`"), tool descriptions that reference sibling tools, and `MUTATING_TOOL_IDS` in
`chef-agent.ts`. A stale name in any of these makes the model call a dead tool.

## Objective

Rename every chef tool id to its namespaced form, everywhere the id appears, with no behavior
change. The mapping:

| Old | New |
|---|---|
| `read_facts` | `facts__read` |
| `update_facts` | `facts__update` |
| `fact_types` | `facts__catalog` |
| `update_tasks` | `tasks__update` |
| `add_members` | `household__add_members` |
| `import_recipe` | `recipes__import` |
| `send` | `chat__send` |

## Acceptance Criteria

- **AC-1 — every id renamed at the source.** Given the mapping, when each tool class's `readonly id`,
  the `FACTORIES` keys, `MUTATING_TOOL_IDS`, the `send` tool's `createTool({ id })`, and the
  onboarding definition's `tools: [...]` are read, then they all carry the new names and no old name
  remains anywhere in `server/src/` (verifiable by grep).
- **AC-2 — prompt/guidance prose updated.** Given `CHEF_PROMPT`, the onboarding task guidance
  strings, and every tool description, when grepped for the old names, then zero hits — each inline
  mention uses the new name.
- **AC-3 — no behavior change.** Given the full test suite, when it runs after the rename, then it
  passes identically (tests referencing old ids updated as part of this WI; only the pre-existing
  `media.test.ts` ffmpeg failure remains).
- **AC-4 — names are provider-portable.** Given every new id, when checked against
  `^[a-zA-Z0-9_-]{1,64}$`, then all match.

## Test Cases

### TC-1 — grep gate (AC-1, AC-2)
**Preconditions:** Rename applied.
**Steps:** `grep -rnE "\b(read_facts|update_facts|fact_types|update_tasks|add_members|import_recipe)\b" server/src/` and the same over `server/test/` (excluding this spec).
**Expected Outcomes:** Zero hits in `server/src/`. Test files reference only new names.

### TC-2 — suite green (AC-3)
**Preconditions:** Rename applied, tests updated.
**Steps:** `pnpm typecheck && pnpm test` in `server/`.
**Expected Outcomes:** Typecheck clean; same pass count as baseline; only `media.test.ts` fails
(pre-existing ffmpeg ENOENT).

### TC-3 — name validity (AC-4)
**Preconditions:** none.
**Steps:** Assert each new id matches `^[a-zA-Z0-9_-]{1,64}$` (a tiny test over the registry keys).
**Expected Outcomes:** All match.

## Test Run

_To be filled during execution._

## Deployment Strategy

Direct deploy. Pure rename, no schema or behavior change; the model reads tool names fresh each
turn, so there is no migration concern. Risk is a missed inline mention — the grep gate (TC-1) is
the guard. Land this **before** the meal-planning WI so the new tools are born namespaced.

## Production Verification

### PV-1 — live turn calls the renamed tools
**Preconditions:** A real iMessage test thread (chef-sim or ime-turn.sh harness).
**Steps:** Send one onboarding message that elicits a fact write (e.g. name a grocery store).
**Expected Outcomes:** The turn completes: fact recorded, reply sent — proving `facts__catalog` /
`facts__update` / `tasks__update` / `chat__send` all resolved.

## Production Verification Run

_To be filled after deployment._
