# WI-04 — The grocery card: /g/:householdId page + richlink

## Background

`server/docs/groceries-chef/DESIGN.md` (§§ the card use case, APIs, plan-card
precedent) gives the household a browsable grocery card in the thread — the plan-card
pattern cloned: public SSR page by unguessable household uuid, sent as one tappable
richlink. Requires WI-01 (household scope); WI-03 supplies grocery__view whose
result should carry the card URL the same way mealplan__generate carries plan_url.

## Objective

`GET /g/:householdId` renders the household's grocery list (aisle-major, checked
sinking, harvest theme), the sink treats it as an app-card URL, and Sage shares it
per the design's tool/objective instructions.

## Acceptance Criteria

1. Given `GET /g/:householdId`, then it renders the list server-side (React
   `renderToStaticMarkup`, daisyUI/harvest theme via `RECIPE_CSS_HREF`), aisle-major
   order with checked items de-emphasized/sinking (mirror `lib/grocery/sort.ts`
   aisle order + `formatQuantity` display semantics per the design), `cache-control:
   no-store` (the list mutates constantly), empty-state per the doc.
2. Given `styles/recipe.css`, then `@source "../src/grocery-page.tsx"` is added and
   `npm run build:styles` re-published — the page MUST NOT ship unstyled (the exact
   plan-page bug, commit 0ebfd7c; the design flags this).
3. Given the sink's `isRecipePageUrl`, then `/g/` URLs send as tappable app cards
   (`sendRecipeCard`), like `/r/` and `/p/`.
4. Given `grocery__view` (WI-03), then its result includes `list_url` built from
   `PUBLIC_APP_URL` (undefined when unset — model then skips the card), and the
   design's objective-instruction line tells Sage when to share it.
5. The page builds its URL space consistently with the plan page (origin passed in,
   og meta, Lora/Karla fonts) — visually consistent with /p.

## Test Cases

Vitest, files individually, `pkill -f vitest`; canonical `npm test`, dev server
stopped.

### Test Case 1: page renders the list (AC-1)

**Steps:** seed a household list (mixed aisles, one checked, one manual, one
quantity_text item); GET /g/:id.
**Expected:** 200 HTML; aisle sections in store-walk order; checked item present but
sunk/de-emphasized; quantities formatted ("1½ cups" style); unknown household → 404
page; no-store header.

### Test Case 2: card routing (AC-3)

**Steps:** sink.send richlink with a /g URL (PUBLIC_APP_URL set) → sendRecipeCard
called, not sendLink.

### Test Case 3: styles ship (AC-2)

**Steps:** after build:styles, the published CSS asset contains a class used only by
grocery-page.tsx (prove the @source scan picked it up).

### Test Case 4: view tool carries the URL (AC-4)

**Steps:** grocery__view with PUBLIC_APP_URL set → list_url present; unset →
undefined.

## Test Run

To be filled during execution.

## Deployment Strategy

Code-only; after WI-03. `npm run build:styles` output committed with the change (the
hashed asset + regenerated styles export). Rollback: plain code rollback.

## Production Verification

### PV-1: the card in the thread

**Steps:** Ask Sage for the grocery list from the phone.
**Expected:** one tappable card; tapping opens the styled page showing the current
list; checking an item in the app then re-opening the card shows it sunk.

## Production Verification Run

To be filled after deploy.
