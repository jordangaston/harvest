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

Run from `server/`, dev server stopped, vitest files individually then the canonical suite.

### TC-1 + AC-1/AC-5 — page renders the list (`test/grocery-page.test.ts`)

```
✓ renderGroceryPage > renders aisle sections in store-walk order, checked items sunk + struck, formatted quantities
✓ renderGroceryPage > prefers a freeform quantity_text and escapes item names
✓ renderGroceryPage > renders the empty state when the list is empty
✓ GET /g/:householdId > renders the seeded list with no-store, an unknown household 404s
✓ GET /g/:householdId > renders the empty state for a household with no items

Test Files  1 passed (1)
     Tests  6 passed (6)
```

Covers: aisle-major store-walk order (produce→meat→dairy→pantry), checked items present but
sunk + `line-through`, quantities formatted ("1½ cups", "2 pounds"), `cache-control: no-store`,
unknown household → 404 page, empty-state.

### TC-3 — styles ship (AC-2, the @source trap)

`@source "../src/grocery-page.tsx"` added to `styles/recipe.css`; `npm run build:styles` republished
`public/assets/recipe.c8f67cbe.css` (was `recipe.867aeb1f.css`). The `published CSS asset (@source
scan)` test in `grocery-page.test.ts` reads the published asset and asserts three grocery-page-only
classes (`line-through`, `items-baseline`, `opacity-60`) are present — proving the scan picked the page up.

### TC-2 — card routing (AC-3, `test/imessage-richlink.test.ts`)

```
✓ consumer routes a grocery-card URL to sendRecipeCard (WI-04 AC3) > sends a /g/ link via sendRecipeCard, not sendLink

Test Files  1 passed (1)
     Tests  5 passed (5)
```

`isRecipePageUrl` extended to match `${PUBLIC_APP_URL}/g/` — a `/g/` richlink dispatches via
`sendRecipeCard` (tappable app card), `linkCalls` empty.

### TC-4 — view tool carries the URL (AC-4, `test/chef-grocery-tools.test.ts`)

```
✓ grocery__view (AC-1) > carries list_url from PUBLIC_APP_URL, undefined when unset

Test Files  1 passed (1)
     Tests  13 passed (13)
```

`grocery__view` result `list_url` = `${PUBLIC_APP_URL}/g/:householdId` when set, `undefined` when unset.
(The `list_url` field and the objective-instruction line — "your grocery list's ready too — say 'what
do we need'" in `first-meal-plan.ts` — shipped with WI-03; this run confirms them.)

### Full canonical suite (`npm test` from `server/`, dev server stopped)

```
Test Files  88 passed (88)
     Tests  691 passed | 1 skipped (692)
  Duration  28.41s
```

Typecheck (`npm run typecheck`) clean.

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
