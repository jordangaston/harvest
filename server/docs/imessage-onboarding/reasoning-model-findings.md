# Chef reasoning layer — model & latency findings

Working notes from tuning the reasoning/response layer (the "private chef" onboarding). Written to
capture what we learned the hard way so the choices below aren't re-litigated. Revisit when we move
past the increment-2 stopgap.

## TL;DR (current config)

- **Reasoning half:** `deepseek-v4-flash`, **thinking ON** (DeepSeek's default), native Mastra
  tool-loop, `structuredOutput` via `jsonPromptInjection`, **single call + retry** (`MAX_ATTEMPTS`),
  `MAX_STEPS = 4`. (`src/chef/reasoning-agent.ts`)
- **Response half:** `deepseek-v4-flash`, **thinking OFF**, `structuredOutput` bubbles.
  (`src/chef/response-agent.ts`)
- **Tools:** self-contained classes (`static create(ctx)` wires their own repos; `asMastraTool()`
  closes over the instance). (`src/chef/tools/*`)
- Verified end-to-end: full 8-turn onboarding persists household prefs (catalog-validated) and
  per-member allergens/diets with **correct attribution** (Jordan→peanut/severe, Sam→pescatarian).

## The root cause behind most of the pain: reasoning is ON by default

DeepSeek v4 (and OpenAI's luna) **reason by default**. That one default caused the bulk of the
symptoms we chased:

- **Latency.** Thinking generates hundreds of reasoning tokens before the answer. Measured on a
  direct call: thinking ON = 4.7s / 393 completion tokens (363 of them reasoning); thinking OFF =
  1.1s / 42 tokens. The reasoning goes to a separate `reasoning_content` field — it never corrupts
  the JSON `content`; the cost is purely *generating* it.
- **Provider knobs:** DeepSeek `providerOptions: { deepseek: { thinking: { type: 'disabled' } } }`;
  OpenAI `providerOptions: { openai: { reasoningEffort: 'none' } }`. `src/parse/extractor.ts`
  already documented the DeepSeek one — we missed it and rebuilt the layer twice before finding it.
- On OpenAI `/v1/chat/completions`, **tools + reasoning is rejected outright** ("use /v1/responses
  or set reasoning_effort to 'none'"). Reasoning + a tool-loop needs the stateful responses API.

## Model comparison (member-attribution turn: allergy → correct member in a 2-person household)

| config | attribution quality | latency/call | reliability |
|---|---|---|---|
| flash + thinking OFF | 1/4 correct | ~2.9s | 3/4 also errored (`undefined` object) |
| **flash + thinking ON** | **4/4 correct** | **~6s** | clean |
| pro + thinking ON | correct | ~30–120s | clean, but pathologically slow |

**flash + thinking ON matches pro's quality at ~10–20× less latency** — flash is small, so its
reasoning trace is a fraction of pro's. thinking-OFF is bad on *both* axes (wrong attribution AND
the reliability miss below). That's why flash+thinking-on is the pick.

Full-run latency: flash+on ≈ 5–6 min for 8 turns (most turns 5–45s, the complex member turn ~92s
with a retry); pro+on was ~15+ min (one turn hit 424s). flash+off was ~1.5 min but wrong.

## The `undefined` object (why we retry)

Single call = tools + `structuredOutput` together. A "call" (`agent.generate`) runs an internal
tool-loop of **steps** (model → tool_call → result → model → …). If the loop's **last step is a
tool call**, there's no final text step, so `res.object` is `undefined`. On DeepSeek this happens
~1/3 of the time regardless of model size (flash and pro both ~4/6). luna doesn't (closes the loop).

Two ways to handle it:
- **Retry the whole call** (current) — simplest, matches "single-phase + retries". Writes are
  idempotent, so a retry that re-persists is safe; `reconcileSlotUpdates` dedupes by key.
- **Two-phase** (act with tools, then a tool-free structured call) — deterministic, no retry, but
  always 2 calls. We used this briefly; dropped it for the retry approach per the single-phase ask.

## Shape matters (native vs prompt-injected structured output)

- **Native `json_schema`** — schema sent as an API param; decoding is constrained → guaranteed shape,
  and the API forces a final structured turn even after a tool call. But strict mode can't express
  `z.unknown()` or a discriminated union with per-variant fields, and **DeepSeek doesn't support it**
  (OpenAI/luna do).
- **`jsonPromptInjection`** — schema pasted into the prompt as text, then parsed. Works anywhere, no
  guarantee. The only structured path for DeepSeek.

Our `ReasoningOutputSchema` (`src/chef/types.ts`) uses a discriminated-union `IntentSchema` and
`value: z.unknown()` — neither is strict-compatible, so luna native rejected it. A **flat shape**
(`intents: { kind: enum, text: string }[]`, `value: string`) is strict-compatible and unlocked
luna native (6/6). The intent union carries nothing the responder actually uses (it just reads the
text), so flattening is a pure simplification if we ever want the native path.

## Known remaining gaps

1. **Member-slot ledger keys collide.** Member-scoped slots are keyed bare (`allergens`, `diets`, …)
   with a `member_user_id` column, but `chef.ts` `mapSlotUpdates` builds `slotIdByKey` from the bare
   `key`, so two members' `allergens` slots collapse to one id. The per-member preference **data
   persists correctly** (via `save_member_profile`), but the member slots never flip to `filled` in
   the ledger — so objective completion can't be detected from member slots. Fix: scope the key the
   model sees/returns by member (e.g. `member:<userId>:<key>`), and map + reconcile on that.
2. ~~Scalar/free-text slots aren't persisted to preference columns.~~ **Resolved.** The tools now
   write every signal to its real home: member `likes`/`dislikes` → `user_food_prefs` (the affinity
   feed, grounded to a facet + catalog value via `search_catalog`), `skill_level` →
   `user_preferences.skill_level`, `weekly_meals`/`cook_days_count`/`time_by_meal` →
   `household_preferences`, and household `goals` → each member's `users.goals` (via a new
   `save_household_goals` tool; feeds `PreferenceRepository.coldStart` weight seeding). `time_by_meal`
   is only written when all three meal times are given (the model requires them positive).
   Remaining minor gaps: the `household_size` slot doesn't always flip to filled (adults/kids are
   captured), and a partial `time_by_meal` is deferred to the settings screen.
3. **Latency.** flash+on is workable but the worst turn (~92s) is slow for a text UX. Options:
   - **decide-once → execute-in-code → respond**: a thinking, *tool-free* call emits the plan +
     the tool actions as data; code runs them. Reasoning fires **once** (no per-step thinking
     multiplication), no live-tool `undefined` misses. (This is the command-emit shape — its real
     justification is that it's the only arrangement where reasoning + deterministic execution +
     sane latency coexist.)
   - **native reasoning tool-loop over `/v1/responses`** (OpenAI) — carries the reasoning trace
     across tool calls; untested here.
   - confirm reasoning is only needed for *orchestration*, and move the (shallow) tool calls to a
     cheap thinking-off pass.

## Things not to re-discover

- Don't chase "flash is unreliable" — it's thinking-on emptying/slowing; set thinking off for
  mechanical JSON, on for decisions.
- Don't blame the model for the `undefined` object — it's the tool-loop ending on a tool-call step.
- Mastra forwards provider knobs via `providerOptions.<provider>` on `generate()`.
- Tools get their deps by being classes (`static create`), not by threading anything through
  Mastra's context.
