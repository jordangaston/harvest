# Wave 2 — founder decisions (build your DESIGN to these)

The CLARIFY gate is answered. Below is every resolved decision + the cross-task boundaries. Build your
`docs/sprint-<task>/DESIGN.md` to these; your own `01-clarif*` file's recommendations are approved except where
this overrides. Do NOT relitigate.

## Cross-cutting (resolved)
1. **Expose `GET /v1/recipes`** — owned ∪ cookbook-entry recipes, deduped, cursor-paginated (`page_token`).
   **OWNER: Meal Planning** builds the endpoint (on `RecipeRepository.listOwned`); Onboarding + Grocery consume it.
2. **Shared ingredient catalog, built from USDA Foundation Foods.** Source:
   `~/Desktop/Business/Harvest/FoodData_Central_foundation_food_json_2026-04-30.json` (`FoundationFoods`, ~395
   foods). Build a committed `server/seed/grocery-catalog.json` (raw source NOT committed) where each entry is
   `{ canonicalName, aisle, defaultUnit, iconKey }`: aisle from `foodCategory` → the `grocery_aisle` pg enum
   (`produce · meat_seafood · dairy_eggs_fridge · bakery · pantry · herbs_spices · frozen · beverages ·
   household · other`, store-walk order, `other` = catch-all); `iconKey` via the existing
   `server/src/parse/icons.ts` mapping (unknown → default); `defaultUnit` a per-category heuristic. **OWNER:
   Grocery List** builds the catalog + `grocery_aisle` enum + a common-ingredients endpoint/data. **Meal
   Planning consumes** the common-ingredients list from the same `grocery-catalog.json` (agreed interface:
   read the file / a `GET /v1/ingredients/common` endpoint Grocery exposes). Unknown ingredients → aisle `other`.
3. **Social import ships UI-only for the share path.** 4 platforms (Pinterest/TikTok/Instagram/YouTube — no
   Facebook). "Import from web" (paste link) and "Try with a sample recipe" (real import of a fixed per-platform
   e2e URL) work end-to-end; "Open {app}" deep-links only; the iOS **Share Extension is NOT built this wave**
   (Wave 3 + a parallel spike will). "Unlock faster importing" renders as coaching UI.
4. **Phone Auth = the last onboarding step; server enforces verification; Phone Auth owns user creation.**
   Add phone-entry + code-entry screens; create the user with the real verified phone (replacing the random
   one). **INCLUDE returning-user sign-in** (new device / after logout — the server already supports OTP +
   refresh sign-in). Provision a **real Twilio number** the agent can read codes from for live e2e — the
   founder will do the manual Twilio console steps; **surface EXACTLY what he must do** (which console
   actions, which creds/env vars you need) via `orca orchestration ask` or in your design's "founder action
   needed" section. **Also collect the user's NAME** at the end of onboarding and save `users.name` (see #6).
   OWNER: Phone Auth adds the name+phone screens, the `users.name` column, and the create-user wiring.
5. **Instrumentation = client-only Mixpanel via `mixpanel-react-native`.** Compact taxonomy: 3 auto events
   (Onboarding Step Completed, Screen Viewed, Button Tapped on the shared `Button` primitive) + ~8 named domain
   actions; onboarding enums as people-properties; Title-Case `Object Action` names, `snake_case` props;
   anonymous → `identify()` at signup. **Token via config, NO-OP when unset — do NOT send data in dev/sim/tests.**
   Assume the token is provided later; build the config shape + a one-pager on how the founder configures prod.
6. **No username — use the user's NAME.** Ask for the name in onboarding, save `users.name`, and address the
   user by name. **OWNER: Phone Auth** adds `users.name` + the name-entry (with the phone step). **Profile
   consumes** it. **Delete-data = FULL account deletion** (explicitly delete the user's `recipes`, `import_jobs`,
   `cookbooks`, `meal_plan_entries`, `grocery_items`, then the user row — `recipes`/`import_jobs` FKs have NO
   cascade) → welcome. **Logout = local-only** (clear the session; stateless JWT) → welcome. Destructive-delete
   confirm in a **`bg-cream` modal**.

## Per-task defaults (approved as your Lead recommended)
- **Meal Planning:** flat `meal_plan_entries(user_id, date, meal, recipe_id, position)`, many recipes/slot;
  Monday-start weeks, absolute `DATE`, client-tz "Today"; **drop Tags + Add-note**; the recipe-screen
  add-to-plan sheet shows a day-picker (recipe pre-chosen). Meal Planning is ONE implementation (not split);
  it also owns `GET /v1/recipes`. Leave the "Add to groceries" button hook for Grocery List.
- **Grocery List** (singular; one list per user): `grocery_items(user_id, name, amount, unit, quantity_text,
  aisle, icon, checked, source_recipe_id, position, created_at)`; inline Todoist-style parse on manual add with
  per-ingredient default unit; recipe ingredients scale linearly by servings (¼ rounding; null-amount rows
  as-is); re-add merges by name+compatible unit; check strikes + sinks; sorts aisle/recipe/A–Z; **order-online
  stays a non-functional stub** (Wave 3).
- **Onboarding:** checklist completion tracked locally (AsyncStorage) — import→first successful import,
  shortcut→carousel finish, cookbook→`cookbooks.length>0`.

## Coordination (avoid collisions)
- **`GET /v1/recipes`** → Meal Planning owns; Onboarding/Grocery consume.
- **`grocery-catalog.json` + `grocery_aisle` enum + common-ingredients** → Grocery List owns; Meal Planning
  consumes by the agreed file/endpoint.
- **`users.name` + name/phone onboarding screens + signup create-user** → Phone Auth owns; Profile + Instrumentation consume.
- **Migrations:** `main` is at 0008. You will each `drizzle-kit generate` a 0009+; numbers WILL collide across
  parallel branches — that's expected, the coordinator reconciles migration order at integration. Just keep
  each migration self-contained and note in your design which tables/enums it adds.
- Binding docs still bind (design system / no `bg-white` / motion tokens; `server/CLAUDE.md`; migrations-only;
  tests never hit the network). `CLAUDE.md` "Multi-agent sprint workflow" governs.

## Your DESIGN task now (then STOP)
Write `docs/sprint-<task>/DESIGN.md` for your task, built to the decisions above + your reference analysis.
**Author it with the `/writing-design-documents` skill; edit it with `/writing-clearly-and-concisely`.** Cover
data model/migrations, API, mobile screens/flows (honor the design system + motion), the cross-task interfaces
you own or consume, a test plan (offline), decisions, and open risks. **DESIGN ONLY — no implementation, no
migrations, no PR.** Report `worker_done` with the design-doc path + a tight summary + your top risks. The
coordinator routes all six designs through the Architect and the founder for sign-off before anyone builds.
