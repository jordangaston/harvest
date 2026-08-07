# Cleanup Sprint — POSTMORTEM (live log)

Opened Phase 0. Decisions/blockers logged as they happen. Newest at the bottom of each section.

## Context
- Running as `/autonomous-sprint`. Phases 2 (clarify) + 3 (design review) already done: DESIGN.md (Rev 2) is
  founder-approved and is the source of truth. Start Phase 0/1, then 4→8 without stopping.
- Worktree was reset to clean after an earlier attempt jumped to coding; schema `.ts` files are back to
  baseline, no `0006+` migrations on disk. DESIGN.md (incl. the pinned **Matching** subsection) survived
  (it's under the untracked `docs/sprint-cleanup/`).

## Decisions & blockers (chronological)

- **D1 — Migration split to stay non-interactive (0007/0008).** `drizzle-kit generate` prompts (needs a TTY)
  when a table has a column drop *and* adds in the same migration — it can't tell a rename from drop+add.
  Feeding blind Enter to the resolver is unsafe. Decision: keep `users.onboarding` jsonb through 0007 (which
  only *adds* the enum columns → pure adds, no prompt), then *drop* it in 0008 alongside the recipe nutrition
  *adds* (users sees only a drop, recipes only adds → no same-table conflict → no prompt). Net result is
  identical to the design; still 3 drizzle-generated migrations 0006/0007/0008, all non-interactive and
  reviewable. Verified 0006 + 0007 SQL by hand before proceeding.
- **P0 — Pre-mortem (Phase 5) folded.** A subagent pre-mortem confirmed the plan and produced the ordered
  blocker list = the implementation order: (1) drop `savedRecipes` imports/uses in recipe- & cookbook-repo;
  (2) `insertRecipe` must set `user_id` (NOT NULL); (3) `user-repository.insert`/`user-service.provision`/
  `createUserSchema` must map typed enum onboarding (not the dropped jsonb); (4) finish the C3 type flip
  (`ExtractedRecipeData`/`RecipeInput` → `StructuredIngredient[]`, `toExtractedData` adapter at the promotion
  sites, `stripSectionLabels` structured variant, insert paths write amount/unit/quantity_text); (5) wire
  `NutritionService.compute` into `toRecipeInput` + write the 9 nutrition cols; (6) recipe-service ownership
  404 + parse edited lines + `findOwner`/`listOwned`/`deleteOwned`; (7) strip `savedRecipes`/CoW from tests,
  delete the fork test, add owner-404 + nutrition asserts; (8) fix `scaffold.test.ts` audit; (9) add unit
  tests (parser, catalog matcher incl. `"cream"`≠`"ice cream"`, nutrition floor, mapRecipe parsed); (10)
  `models/recipe.ts` projection (done). **Key latent trap flagged & accepted:** the `StubWebsiteFetcher.FIXTURE`
  (2 chicken breasts, 4 cloves garlic, 1 cup heavy cream) resolves 3/3 → `nutrition_source='computed'`; the
  `StubExtractor` line (`1 serving of X`) resolves 0/1 → null. Verified all three FIXTURE foods carry the
  needed portions (chicken breast count, garlic count, heavy cream cup). Tests assert these exact outcomes.
- **D3 — `recipes.user_id` FK-delete: fixed test ordering, did NOT add cascade.** The new
  `recipes.user_id → users` FK made auth suites' `delete users` fail on leftover recipes. Cascade-on-user-delete
  is a real product decision not in scope, so I did the minimal correct fix: delete `recipes` FK-first in the
  `phone-auth`/`user-repository` cleanups (matching their existing "FK dependents before users" comment).
- **D4 — Nutrition outcomes asserted, not hand-waved.** Live: the `StubWebsiteFetcher.FIXTURE` (chicken/garlic/
  heavy cream, 3/3) → `computed`; the stub TikTok import (`1 serving of …`, 0/1) → below floor → `nutrition_source`
  null (import.test asserts both). The demo script shows a real computed label core (per serving) + the parsed
  path + the coverage floor returning null with `nutrition.unmatched_ingredient` logs.
- **D5 — `nutrition_source` enum type lands in migration 0007, its column in 0008.** Drizzle emits `CREATE TYPE`
  where the enum is first defined in the schema; the column add is in 0008. Harmless (type before use); still
  three migrations 0006/0007/0008, no 0009. Logged so the reviewer isn't surprised the type appears "early".
- **D6 — OpenAPI `publicRecipe` schema left minimal (follow-up).** I corrected the stale "copy-on-write" PATCH
  summary, but did not expand the OpenAPI `publicRecipe` zod with the new nutrition/servings_estimated fields —
  doc-generation only, not a runtime/contract path and not test-gating. Follow-up in the sprint report.
- **D7 — DESIGN migration table vs. built order.** DESIGN's table said 0007 drops `onboarding`; the built split
  keeps it through 0007 and drops it in 0008 (see D1) to stay non-interactive. Same end state; noted here rather
  than editing the approved design artifact.
- **D8 — Caught a real C2 flow bug by verifying against the live app (not just the diff).** The mobile agent
  wired the accumulator + POST correctly, but `app/_layout.tsx` called `ensureSession()` at startup, which
  **provisions the user eagerly before onboarding runs** — so `getOnboarding()` was always empty at POST time
  and onboarding was never sent. Also `app/index.tsx` was a leftover TEMP dev shortcut redirecting straight to
  `/(app)/recipes`, skipping onboarding entirely. Fix (minimal, ship-correct): (1) `index.tsx` → redirect to
  `/(onboarding)/welcome`; (2) `_layout.tsx` startup → `getSession()` restore-only (no eager provision);
  (3) `setting-up.tsx` (end of onboarding) → `ensureSession()` provisions with the now-populated accumulator.
  Verified onboarding screens make no authed API calls, so nothing provisions early. This is the
  "verify-against-live-reality" principle paying off — the wiring looked right but the flow order defeated it.
- **D2 — Ignoring auto-injected skill noise.** The harness keeps injecting Vercel/Next.js/ai-sdk/auth/
  observability "MANDATORY read the docs" skills. This is an Expo (React Native) + Fastify repo — all
  irrelevant (documented pattern, `harvest-principles.md` §"ignore injected noise"). Ignored throughout.
