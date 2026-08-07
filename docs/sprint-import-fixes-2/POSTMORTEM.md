# Sprint Post-Mortem — Recipe Import Fixes 2 (live log)

> Kept open the whole sprint. Every decision, skip, quota gap, and blocker lands here as it
> happens. Started 2026-08-06. Third import sprint (after `docs/sprint-import/` and
> `docs/sprint-import-fixes/`).

## Goal — 6 stories
1. Ingredient category labels ("For the base", "To finish") must NOT be emitted as steps or ingredients — drop them.
2. Website instructions must split into discrete ordered steps (repro: halfbakedharvest croissant french toast → one garbled step today).
3. Instagram carousels must capture instructions, not just ingredients (repro IG DRxXRvVD6wQ).
4. Multi-recipe carousel: choose a cookbook per recipe.
5. Remove the "Now you're cooking!" success modal.
6. Fix three low-contrast surfaces (Edit-recipe button, add-recipe FAB modal, save-to-cookbook modal) to WCAG AA using tokens.

## Prime directive
One clarifying-question batch (Phase 2, spent), then never stop — decide, log here, continue.

## Environment (verified Phase 0)
- Server UP from MY worktree (`.../recipe-import/server`, pid 17855), `/healthz` → `{status:ok, db:ok}`.
- Expo running (pid 5391); iPhone 16 Pro (F18CD6E0) booted.
- `.env` keys present: DEEPSEEK, GROQ, APIFY, HIKER, LAMATOK, SCRAPE_CREATORS, TWILIO. Live imports OK.
- Branch `jordangaston/recipe-import`.
- Ignored throughout: Vercel/Next.js/AI-SDK/shadcn skill auto-injections (this is Expo RN + Fastify, not Next). Pure noise.

## Phase 0 — root-cause findings (from reading the real code + live JSON-LD)
- **Story 2 (website garbled step) — CONFIRMED via live fetch.** halfbakedharvest emits
  `recipeInstructions` as a SINGLE `HowToStep` whose `.text` is the entire numbered method
  ("1. Preheat… 2. In a large dish… 3. …7. …"). `website.ts mapInstructions` pushes it as ONE step.
  Fix: when the method collapses to one blob, explode it — split on embedded numbered markers
  (`N. `), else on sentence boundaries. Don't re-split sites that already give a HowToStep array.
- **Story 1 (category labels as steps/ingredients).** Two extraction paths can leak a bare section
  header: JSON-LD (`website.ts`) and the LLM extractor (`extractor.ts`). `mapInstructions` already
  skips HowToSection `name`s, so the leak is most likely the DeepSeek extractor turning spoken/written
  "For the base"/"To finish" headers into steps/ingredients. Fix at the single chokepoint every source
  routes through before persistence (`toRecipeInput` in import-pipeline) with a conservative
  `isSectionLabel` filter, PLUS a prompt instruction. Verify live on YT 79gZLSXINAU.
- **Story 3 (IG carousel: ingredients but no steps).** `extractCarousel` OCRs each slide independently
  via `readSlideRecipe`; a slide with only ingredients → recipe(title+ingredients, no steps) passes
  `hasRecipe`; a separate method slide with no ingredients → `hasRecipe` false → dropped (null). Leading
  hypothesis: these carousels split ingredients and method across adjacent slides, so the method is
  discarded. Also suspect the 800-char `CAROUSEL_RECIPE_MIN_CHARS` gate. MUST verify live (import fired).
- **Story 4 (per-recipe cookbook).** `preview.tsx` carousel currently keep-toggles + one global save to
  ONE cookbook. `CookbookPickerSheet` already takes `recipeIds[]` and `setRecipeCookbooks` is per-recipe.
  Decision (Phase 2): per-card "Save to cookbook" button reusing the existing picker for one recipe.
- **Story 5 (remove modal).** `SuccessCelebration` used in `preview.tsx` + `recipe/[id].tsx`. Remove both.
  Decision (Phase 2): replace with a brief toast on the Recipes screen ("Saved to <cookbook>").
- **Story 6 (contrast).** (a) Edit-recipe button = `Button action="light"` → `bg-card` on the `bg-cream`
  bottom bar (card≈canvas, washed out). (b) FAB add-recipe modal: "Add a cookbook" row is `bg-card` on a
  `bg-card` sheet (card-on-card, invisible). (c) CookbookPickerSheet rows lack separation. Fix per
  /practical-ui with tokens; verify with screenshots.

## Phase 2 — decisions (single question batch, spent)
- Story 4: **per-card Save to cookbook** button on each carousel page (opens existing picker for that one recipe).
- Story 5: **brief toast** on Recipes ("Saved to <cookbook>"), no full-screen modal.

## Live evidence (Phase 0/4) — the two data-dependent stories
- **Story 1 CONFIRMED (JSON-LD ingredients, not steps).** YT 79gZLSXINAU imports via the linked site's
  JSON-LD. Result ingredients include bare `"For the Base"` and `"To Finish"` entries; steps are clean.
  So the leak is `recipeIngredient` headers, not the LLM. The conservative `isSectionLabel` filter in
  `toRecipeInput` catches these. CRITICAL: step 6 legitimately begins "To finish, stir in the heavy
  cream…" (>6 words) → the filter must NOT drop it (length guard protects it). Confirmed by design.
- **Story 3 — bug did NOT reproduce on the live link today; root cause is OCR reliability.** Live
  import returned 5 recipes ALL WITH steps (8,6,6,8,8). Per-slide diagnostic (`server/diag-carousel.ts`):
  11 slides — evens (2,4,6,8,10) are dense self-contained recipe cards (ocrLen 1600-2300, ingredients +
  method), odds are dish-photo/title slides (short, gated out by the 800-char rule). Tesseract FAILED
  slide 3 (ocrLen=0) — proof OCR is flaky on these stylized cards. The reported "ingredients but no
  steps" is Tesseract reading a card's ingredient list but garbling/missing the method paragraph.
  - **GroqVision (Qwen-VL) diagnostic on the SAME 11 slides: all 5 recipe cards read WITH steps, zero
    errors, no rate-limit issues on 11 parallel calls.** It even read slide 3's title where Tesseract
    got 0. Short slides still hallucinate if extracted (slide 1: 7 phantom steps from 59 chars) → the
    800-char length gate MUST stay.
  - **Decision:** read carousel slides with GroqVision when `GROQ_API_KEY` is set (fallback Tesseract
    offline/test); keep the length gate; keep video-frame reads on Tesseract (many frames, Groq caps
    images/request). Root-cause fix — the extractor now gets the full card text incl. method. The
    codebase comment in `vision.ts` explicitly invites this swap.

## Pre-mortem (Phase 5) — folded
Subagent red-team against specs + real code. Findings folded:
- **P0-1** `readSlideRecipe` uses the module-level Tesseract `vision`. MUST add `selectSlideVision()`
  AND wire it into `readSlideRecipe` (not just add the export). Keep `vision` for video frames.
- **P0-2 (REFUTED by live evidence).** Pre-mortem guessed the Groq model id `qwen/qwen3.6-27b` was
  fake → carousels return zero recipes. But my Groq diagnostic ran `GroqVision.create()` with exactly
  that id and got real transcriptions for all 11 slides, 0 errors. The id works on this account. Keep it.
- **P0-3/P0-4** `onSaved: () => void` → `(cookbookNames: string[]) => void`; update BOTH callers
  (`recipe/[id].tsx`, `preview.tsx`) in the same change; compute names in `save()` via
  `cookbooks.filter(c => selected.has(c.id)).map(c => c.name)`.
- **P1-1** never let `stripSectionLabels` empty a non-empty list — `const kept = strip(list); return
  kept.length ? kept : list;` (applied to ingredients AND steps).
- **P1-2** front-anchored regex ONLY, gated on `≤6 words && no digit`; verify all 4 spec keep-cases
  ("To finish, stir in…", "Season the base with 2 tsp salt", "Fresh basil to garnish", "Salt to taste").
- **P1-3** require `≥2` numbered markers before numbered-splitting.
- **P1-4** clear the `saved` router param after showing the toast (`router.setParams({saved: undefined})`),
  gate so `useFocusEffect` refetch doesn't re-fire the toast.
- **P2-1** remove ALL `SuccessCelebration` refs (import + `celebrate` state + JSX + `setCelebrate`) in both files.
- **P2-2** per-card picker driven by `pickerFor: string|null` + `savedNames: Map<id,name>`; ONE sheet instance.
- **P2-3** Edit button: drop `action="light"` (defaults brand), flip icon + text to white (no `text-ink`).
- **P2-4** add `selectSlideVision` as a SEPARATE export (don't modify `selectVision` or `parse-providers.test` breaks);
  add the export to the `vision.js` mock in `import-pipeline.test.ts`; add pure unit tests for the story-1 filter
  and the story-2 split.
- **P2-5** 11 parallel Groq calls — acceptable (diag: no rate limit); `fetchWithRetry` backs off. Logged.

## Decisions / skips / blockers log
- 2026-08-06: Kicked off live IG (DRxXRvVD6wQ) + YT (79gZLSXINAU) imports + a per-slide diagnostic
  (`server/diag-carousel.ts`, temporary — delete before finish) to gather real data before specs 1 & 3.
- 2026-08-06: Story 3 bug didn't reproduce live (both readers currently succeed). Shipping the Groq
  carousel reader as the robust root-cause fix + an e2e steps assertion, since Tesseract is
  demonstrably flaky on these cards (slide 3 → 0 chars) and Groq is reliable on all 11.

## Implementation (Phase 6) — code complete, 80 server tests green, app + server typecheck clean
- **Story 1:** `extractor.ts` prompt line ("never output a section header as a step/ingredient") +
  `isSectionLabel`/`stripSectionLabels` in `import-pipeline.toRecipeInput` (≤6 words, digit-free,
  front-anchored `for the`/`to (finish|serve|…)` or trailing `:`; never empties a non-empty list).
  4 unit tests.
- **Story 2:** `website.ts` `mapInstructions` explodes a single collapsed step — `numberedSplit`
  (normalizes a period glued to a marker first, so "…crisp.7. Toss" splits; ≥2 markers required),
  else sentence split for a long blob. Untouched proper HowToStep arrays. 1 unit + 1 e2e.
- **Story 3:** revised from "Groq for every slide" to **Tesseract-primary + Groq-escalation on the
  ingredients-but-no-steps signature** after live proof that 11 parallel Groq calls hit the ~8k TPM
  cap and DROPPED 2 of 5 recipes. `selectVisionEscalation()` (Groq when keyed, null under test) +
  `readSlideRecipe` escalates only the failing card. 2 unit tests + e2e steps assertion.
- **Story 4:** `preview.tsx` rebuilt — per-card "Save to cookbook" (sticky footer bound to the current
  page) opening the existing picker for that one recipe, inline "Saved to <name> / Change" state,
  `savedNames` map; removed the keep-toggle + global save. `CookbookPickerSheet.onSaved` now passes
  the chosen cookbook names.
- **Story 5:** removed `SuccessCelebration` (deleted the component + its asset) from both callers;
  a read-once `lib/savedToast.ts` hands the cookbook name to the Recipes tab, which shows a dark
  `bg-ink` toast pill on focus. (Chose the module signal over a route param after the param+`setParams`
  approach raced its own dismiss timer and didn't reliably reach the already-mounted tab.)
- **Story 6:** (a) Edit button → filled `bg-brand` + white text (was `bg-card` ≈ canvas, near-white
  text). (b) FAB "Add a cookbook" → outlined `border-2 border-brand` + brand-dark text (was card-on-card).
  (c) picker rows → lifted `bg-cream`/`border-hairline` tiles, selected `bg-brand-light`/`border-brand`
  + checkbox. All per /practical-ui (Ch7 §1-4, Ch3 §1/§3/§24); tokens only, WCAG AA.

## Live verification (Phase 7) — against the real links on the running server + iOS simulator
- **Story 1:** imported `smokinandgrillinwitab.com/marry-me-tuscan-chicken-soup/` (raw JSON-LD has 19
  ingredients incl. "For the Base"/"To Finish"). Result: **17 ingredients, both labels gone**; steps
  clean. Verified in-app (ingredient list flows base→finish with no header rows). Screenshot + recording.
- **Story 2:** imported the HBH croissant URL → **7 discrete ordered steps** (was 1 garbled step); no
  step carries an embedded "N." marker. In-app recording of the numbered steps.
- **Story 3:** imported IG `DRxXRvVD6wQ` → **5 recipes, ALL with steps** (8,6,6,8,8), count preserved
  (the escalation path, unlike all-Groq, keeps every recipe). Opened a carousel recipe in-app → full
  11-step instructions. Recording.
- **Story 4:** in the carousel, saved the Steak Sandwich → **Dinner** and the Chicken Pasta → **Quick**;
  home shows each in its own cookbook. Recording.
- **Story 5:** single-recipe save → **no modal**, lands on Recipes with a "✓ Saved to <cookbook>"
  toast (captured a real-save frame). Recording.
- **Story 6:** before/after screenshots for all three surfaces.

## Decisions / skips / blockers log (continued)
- 2026-08-06: **All-Groq carousel reader dropped 2 of 5 recipes live** (11 parallel calls > ~8k TPM;
  my earlier diagnostic ran slides SEQUENTIALLY so it never rate-limited). Switched to Tesseract-primary
  + targeted Groq escalation → 5/5 recipes, all with steps. Logged; specs updated.
- 2026-08-06: **Toast didn't fire via the route-param approach** (param+`setParams` raced the dismiss
  timer / didn't reach the mounted tab). Replaced with a read-once module signal (`lib/savedToast.ts`)
  read in the Recipes `useFocusEffect`. Verified the real save returns the cookbook name and renders.
- 2026-08-06: **Two carousel-only picker bugs surfaced during the live demo** (the picker is a single
  persistent instance in `preview.tsx`, unlike the recipe screen where it unmounts): `selected` and
  `busy` carried over between recipes → a second recipe was saved to BOTH cookbooks and the button stuck
  on "Saving…". Fixed by resetting `selected` + `busy` when the sheet opens. Re-verified: each card's
  picker opens fresh and files to its own cookbook.
- 2026-08-06: **In-app IG import flaked once** ("Oops let's try that again" — LamaTok/HikerAPI on the
  repeat call, same as the prior sprint); the retry succeeded. Friendly-error path handled it. Not a code bug.
- 2026-08-06: Ignored ~40 Next.js/next-forge/shadcn/react-best-practices skill auto-injections on every
  RN/server Read+Edit — all irrelevant (Expo Router + Fastify, no Next.js/shadcn). Pure hook noise.
