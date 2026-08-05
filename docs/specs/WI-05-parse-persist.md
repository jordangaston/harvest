---
title: "WI-05 — Parse + Persist"
feature: harvest-core
depends_on: [WI-04]
status: ready
date: 2026-08-03
---

# WI-05 — Parse + Persist

## Background

WI-03 shipped the import pipeline skeleton with a pluggable parse seam
(`src/pipeline/parse-step.ts`): a `ParseProvider` maps a resolved source to a
terminal `ParseOutcome` (`ready` + `recipeId`, or `failed` + `errorCode`), and
the DBOS workflow runs it as a durable step. The default is a sentinel stub that
always returns `NO_RECIPE`. WI-04 shipped the source fetchers
(`src/fetch/*`): website JSON-LD, TikTok oEmbed, Apify social posts, and an
ffmpeg media extractor (audio + sampled frames).

WI-05 fills the seam: a **real** `ParseProvider` that turns a fetched source into
a persisted recipe. It routes each source type through the cheapest capable path
(caption/JSON-LD first; ASR + vision only when needed), extracts a structured
recipe, and writes it to `recipes` + `ingredients` + `recipe_steps` +
`saved_recipes` (the join that puts it in the user's cookbook).

## Objective

Replace the stub `ParseProvider` with a real orchestration wired at boot, plus
the AI providers it needs — Groq Whisper (ASR, O-04), Qwen-VL on Groq (frame
vision, O-05), Qwen extraction on Groq with Claude escalation (O-06), ingredient
icon mapping (O-09) — and a `RecipeRepository` that persists the recipe (O-08).
Every external provider ships a **real implementation and an offline stub**,
selected by env-var presence, exactly like WI-02's `OtpProvider` and WI-04's
`selectSourceFetcher`. Going live is an env swap, no code change.

## Constraints (follow `server/CLAUDE.md`)

- No DI container. Singletons + classes with `static create()`. Zod domain
  models `parse`d at the repository boundary.
- **No new HTTP SDK dependencies.** Groq is OpenAI-compatible and Claude has a
  JSON HTTP API — call both with the built-in `fetch`, matching `website.ts` /
  `tiktok-oembed.ts`. (`apify-client` already exists; keep it.)
- Methods ≤ ~10 lines. Comments only for non-obvious code.
- Persist as one `db.transaction` (recipe → ingredients → steps → saved_recipes).
- Tests drive the **stubs** — no network, no ffmpeg, no spend. As few tests as
  cover all paths.

## Providers (real + stub, env-gated)

Add to `src/config/env.ts` (all optional): `GROQ_API_KEY`, `ANTHROPIC_API_KEY`.
Presence → real provider; absence → stub. Add both to `.env.example` with a note.

| Module | Interface | Real | Stub | Gate |
|---|---|---|---|---|
| `src/parse/asr.ts` | `Transcriber.transcribe(wav: Buffer): Promise<string>` | `GroqWhisper` — POST multipart to `https://api.groq.com/openai/v1/audio/transcriptions`, model `whisper-large-v3-turbo` | `StubTranscriber` — fixed transcript | `GROQ_API_KEY` |
| `src/parse/vision.ts` | `FrameReader.readFrames(images: Buffer[]): Promise<string>` | `GroqVision` — Qwen-VL chat completion, frames as base64 `data:` image_url parts | `StubVision` — fixed on-screen text | `GROQ_API_KEY` |
| `src/parse/extractor.ts` | `RecipeExtractor.extract(ctx: ParseContext): Promise<ExtractedRecipeData>` | `GroqExtractor` — Qwen JSON structured output; escalates to `AnthropicExtractor` (Claude) when `confidence < 0.6` | `StubExtractor` — deterministic recipe from the caption | `GROQ_API_KEY` (+ `ANTHROPIC_API_KEY` for escalation) |

`ParseContext = { caption?, transcript?, visionText?, structured?: ExtractedRecipe }`.
`ExtractedRecipeData` mirrors `ExtractedRecipe` (title, ingredients, steps,
servings?, totalMinutes?, imageUrl?) plus `confidence: number` (0–1).

## Domain + persistence

- `src/models/recipe.ts` — `RecipeSchema` (Zod) matching the `recipes` row +
  `toPublicRecipe` (id, title, sourceType, sourceUrl?, servings?, totalMinutes?,
  imageUrl?, confidence?).
- `src/repositories/recipe-repository.ts` — `RecipeRepository` with
  `static create()` and `persist(recipe: RecipeInput, userId): Promise<string>`:
  one `db.transaction` inserting the recipe, its ingredients (with
  `mapIngredientIcon` from `src/parse/icons.ts`, O-09), its steps, and a
  `saved_recipes` row for `userId`. Returns the new `recipeId`. Idempotent on
  `saved_recipes` (unique `user_id,recipe_id`): swallow a duplicate save.

## The parse provider (O-08 orchestration)

`src/parse/parse-provider.ts` exports `createParseProvider(): ParseProvider`,
wiring the selected transcriber / vision / extractor / `RecipeRepository`. It
routes by `input.sourceType`:

| Source | Path |
|---|---|
| `website` | `fetchWebsiteHtml` → `parseRecipeFromHtml` → structured (Tier 0, **no LLM**). |
| `tiktok` | `TikTokOembed.fetch` caption → `extract`. (Video ASR/vision is the escalation seam; wire it, stub-tested.) |
| `instagram` / `facebook` / `pinterest` | `selectSourceFetcher().fetchPost`. If `outboundLink` → recurse via the `website` path (Q-01). Else caption (+ video → `MediaExtractor.audio` → ASR; frames → vision) → `extract`. |
| `photo` | vision on the image → `extract`. |

Then: `structured ?? extractor.extract(ctx)` → if no title or zero ingredients,
return `failed` `NO_RECIPE`; else `recipeRepository.persist(...)` → `ready` +
`recipeId`. Map thrown fetch/media errors to `failed` `FETCH_FAILED` /
`MEDIA_UNAVAILABLE`; extraction throw → `EXTRACTION_FAILED`.

Register at boot: call `setParseProvider(createParseProvider())` in `src/index.ts`
`main()` before `initDbos()`. (Tests keep swapping the provider via the seam.)

**BR-07 thumbnail re-host is DEFERRED** — no object storage is provisioned yet.
Store the source `imageUrl` on the recipe as-is; mobile renders it remotely
(WI-08). Add a `ponytail:` note; re-host is a follow-up when hotlinking breaks.

## Acceptance Criteria

- **AC-1 (website, Tier 0):** Given a `website` source whose page has JSON-LD,
  when parsed, then a recipe with its title/ingredients/steps is persisted, a
  `saved_recipes` row exists for the user, and the outcome is `ready`. **No LLM
  call is made.**
- **AC-2 (caption extract):** Given a `tiktok` source, when parsed with the stub
  extractor, then the caption yields a recipe and the outcome is `ready`.
- **AC-3 (outbound link → website):** Given a `pinterest` post whose
  `outboundLink` is a recipe page, when parsed, then it follows the link and
  persists the page's recipe.
- **AC-4 (no recipe):** Given a source that yields no title/ingredients, when
  parsed, then the outcome is `failed` with `NO_RECIPE` and nothing is persisted.
- **AC-5 (persistence shape):** `persist` writes recipe + N ingredients (each
  with an icon) + M steps + one `saved_recipes` row in a single transaction;
  re-saving the same recipe for the same user does not duplicate the join row.
- **AC-6 (env gate):** With no `GROQ_API_KEY`, `select*` return stubs; with it
  set, they return the real providers. (Assert selection, not network.)
- **AC-7 (icons, O-09):** `mapIngredientIcon` maps known ingredient names to icon
  keys and falls back to a default for unknowns.

## Test Cases

Integration (local Postgres, stub providers via `setParseProvider`):
- **TC-1** AC-1: website fixture HTML → `ready`; assert rows + no-LLM (stub
  extractor `extract` spy not called on the website path).
- **TC-2** AC-2: tiktok stub → `ready`, recipe rows present.
- **TC-3** AC-3: pinterest stub (has `outboundLink`) → follows to website path.
- **TC-4** AC-4: empty source → `failed` `NO_RECIPE`, zero recipe rows.
- **TC-5** AC-5: `RecipeRepository.persist` unit/integration — row counts +
  idempotent re-save.

Unit:
- **TC-6** AC-6: `selectTranscriber/Vision/Extractor` return stub vs real by env.
- **TC-7** AC-7: `mapIngredientIcon` known + unknown.

## Deployment

Behind the existing pipeline; no schema change (WI-01 shipped the recipe tables).
Ship with stubs (no keys) → imports resolve to `NO_RECIPE`/stub recipes; add
`GROQ_API_KEY` + `ANTHROPIC_API_KEY` to go live. Rollback = unset keys.
