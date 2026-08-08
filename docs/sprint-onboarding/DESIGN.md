---
tags: [onboarding], tdd
summary: "Onboarding Improvements technical design document"
locked: false
---

# Onboarding Improvements — Design

The home ("Cookbooks") screen gains a **"Let's get cooking!" checklist** that guides a new user through
three first actions — import a recipe, unlock faster importing, create a cookbook. Tapping the first item
opens an **Add-a-recipe** flow (Import from social media / Import from web); the social path teaches the
share gesture per platform and can import a **real sample recipe**. This is a **client-only** feature:
**no new tables, no new endpoints, no migrations.** It consumes what Cleanup already shipped.

The single load-bearing constraint (founder decision #3): the iOS **Share Extension is not built this
wave**, so the social share path is **UI-only** — "Open {app}" deep-links, the share carousels and the
"Unlock faster importing" shortcut are **coaching illustrations**, and the only imports that complete
end-to-end are **paste-a-link** and **Try-with-a-sample-recipe** (both route through the existing import
pipeline).

---

# Reviews

| Reviewer | Status | Feedback |
|---|---|---|
| Architect | not_started | |
| Founder | not_started | |

---

# Use Case Implementations

Flow IDs are local to this document (no formal use-case doc exists for onboarding).

- **F-01** Render + complete the home checklist
- **F-02** Add a recipe → choose a source
- **F-03** Import from web (paste a link)
- **F-04** Import via social — learn the gesture + Try a sample recipe
- **F-05** Unlock faster importing (shortcut coaching carousel)
- **F-06** Create the first cookbook (reuses the existing sheet)

## F-01 Render + complete the home checklist — Implements F-01

The checklist card sits above the Cookbooks grid. Completion is read on every screen focus: two booleans
from `AsyncStorage` (first-import, shortcut-done) and the already-fetched cookbook count. When all three
are done the card renders fully struck-through and collapsed.

~~~mermaid
sequenceDiagram
    participant U as User
    participant R as RecipesScreen
    participant C as ChecklistCard
    participant S as onboardingChecklist (AsyncStorage)
    participant API as listCookbooks() [Cleanup]

    rect rgb(240,248,255)
    note over R,API: On focus (useFocusEffect)
    R->>API: GET /v1/cookbooks
    API-->>R: ApiCookbook[]
    R->>S: read {importedFirst, shortcutDone}
    S-->>R: booleans
    R->>C: checklistState({importedFirst, shortcutDone, cookbookCount})
    note over C: item1=importedFirst · item2=shortcutDone · item3=cookbookCount>0
    end

    alt an item is incomplete
    U->>C: tap a pending row
    C->>R: route to that item's flow (F-02 / F-05 / F-06)
    else all three complete
    note over C: card auto-collapses, rows struck-through, no longer tappable
    end
~~~

## F-02 Add a recipe → choose a source — Implements F-02

~~~mermaid
sequenceDiagram
    participant U as User
    participant R as RecipesScreen
    participant A as AddRecipeSheet (Modal, slide)
    U->>R: tap "Import your first recipe" OR the + FAB
    R->>A: open (bg-cream sheet)
    note over A: two rows (bg-card): "Import from social media" · "Import from web"
    alt social
    U->>A: tap "Import from social media"
    A->>A: push ImportSocialSheet → 4 platform rows
    U->>A: tap a platform → route /import-source?source=Pinterest|TikTok|Instagram|YouTube (F-04)
    else web
    U->>A: tap "Import from web" → route /import (F-03)
    end
~~~

## F-03 Import from web — Implements F-03

Exists today (`app/import.tsx` → `app/importing.tsx`). Onboarding only adds the entry point and the
completion side effect.

~~~mermaid
sequenceDiagram
    participant U as User
    participant I as ImportScreen (paste link)
    participant P as ImportingScreen
    participant API as POST /v1/imports · GET /v1/imports/:id [Cleanup]
    participant S as onboardingChecklist

    U->>I: paste URL, tap Import
    I->>P: route /importing?url=...
    P->>API: runImport(url) (poll to terminal)
    API-->>P: ready(recipeIds) | no_recipe | failed
    alt ready
    P->>S: set importedFirst=true
    P->>P: route /preview (many) or /recipe/:id?mode=preview (one)
    else no_recipe / failed
    P->>U: friendly error, retry
    end
~~~

## F-04 Import via social — learn the gesture + sample — Implements F-04

`app/import-source.tsx` grows a swipeable instruction carousel and a wired sample URL. Because Harvest is
not in the iOS share sheet this wave, **"Open {app}" only deep-links** (educational); the recipe that
actually lands comes from **Try with a sample recipe**, a real import of a fixed per-platform e2e URL.

~~~mermaid
sequenceDiagram
    participant U as User
    participant PS as PlatformScreen (import-source)
    participant OS as Native app (deep link)
    participant P as ImportingScreen
    participant API as import pipeline [Cleanup]
    participant S as onboardingChecklist

    note over PS: mock post + carousel: tap send → tap share-to → tap Harvest (coaching only)
    alt Open the app (educational)
    U->>PS: tap "Open {Platform} to find a recipe"
    PS->>OS: Linking.openURL(scheme) → fallback https on failure
    note over U,OS: user browses; cannot share back (no Share Extension) — returns manually
    else Try with a sample recipe (works end-to-end)
    U->>PS: tap "Try with a sample recipe"
    PS->>P: route /importing?url=SAMPLE_URL[platform]
    P->>API: runImport(sampleUrl)
    API-->>P: ready(recipeIds)
    P->>S: set importedFirst=true
    P->>P: route /preview | /recipe/:id?mode=preview
    end
~~~

## F-05 Unlock faster importing — Implements F-05

A coaching carousel that mirrors Recime's shortcut setup: an intro slide then five illustrated steps
(More → Edit → +ReciMe → drag to top → Done). Since Harvest is not yet a share-sheet activity, the steps
are **illustrations**, not a live iOS sheet — swiping to the end marks the item done. (When the Share
Extension ships in a later wave, the final CTA can invoke the real share sheet.)

~~~mermaid
sequenceDiagram
    participant U as User
    participant SC as ShortcutCarousel (Modal, slide)
    participant S as onboardingChecklist
    U->>SC: tap "Unlock faster importing"
    note over SC: intro "Save recipes faster" → steps 1..5 (illustrated iOS share-sheet mocks)
    U->>SC: swipe through to the last step, tap "Done"
    SC->>S: set shortcutDone=true
    SC->>U: close → checklist row now complete
~~~

## F-06 Create the first cookbook — Implements F-06

Reuses the existing `NewCookbookSheet` (Cleanup). No new work beyond the checklist entry point; on
success the cookbook count becomes > 0 and item 3 completes on next focus.

---

# Entities

Onboarding introduces one **client-side** value object. It reads Cleanup's domain entities but owns no
server state.

~~~mermaid
classDiagram
    class ChecklistState {
        +bool importedFirst
        +bool shortcutDone
        +int cookbookCount
        +bool item1Done()
        +bool item2Done()
        +bool item3Done()
        +bool allDone()
    }
    class Cookbook {
        +string id
        +string name
        +int recipe_count
    }
    class ImportJob {
        +string id
        +string status
        +string[] recipe_ids
    }
    ChecklistState ..> Cookbook : counts (read-only)
    ChecklistState ..> ImportJob : first success flips importedFirst
~~~

---

# Tables

**None.** Checklist completion is device-local (`AsyncStorage`), not server state, so it needs no column
and survives as a per-install flag (decision #Local-completion). `users.onboarding_completed_at` and
`users.name` are owned by Phone Auth, not this task. If a future wave wants cross-device checklist state,
that is a separate migration — out of scope here.

---

# Modules

~~~mermaid
classDiagram
    class RecipesScreen {
        +useFocusEffect() load cookbooks + flags
    }
    class ChecklistCard {
        +render(ChecklistState)
        +onItemPress(item)
    }
    class AddRecipeSheet {
        +onSocial()
        +onWeb()
    }
    class ImportSocialSheet {
        +platforms: Platform[4]
    }
    class PlatformScreen {
        +openApp(scheme)
        +trySample(SAMPLE_URL)
    }
    class ShortcutCarousel {
        +onFinish()
    }
    class onboardingChecklist {
        <<module>>
        +getFlags() Promise~Flags~
        +setImportedFirst()
        +setShortcutDone()
        +checklistState(flags, cookbookCount) ChecklistState
    }
    RecipesScreen --> ChecklistCard
    RecipesScreen --> onboardingChecklist
    ChecklistCard --> AddRecipeSheet
    ChecklistCard --> ShortcutCarousel
    ChecklistCard --> NewCookbookSheet
    AddRecipeSheet --> ImportSocialSheet
    ImportSocialSheet --> PlatformScreen
    PlatformScreen --> onboardingChecklist
    ShortcutCarousel --> onboardingChecklist
~~~

~~~mermaid
flowchart LR
    Cookbooks[GET /v1/cookbooks] -->|ApiCookbook[]| RS[RecipesScreen]
    AS[(AsyncStorage flags)] -->|Flags| RS
    RS -->|ChecklistState| CC[ChecklistCard]
    PS[PlatformScreen] -->|SAMPLE_URL| IMP[ImportingScreen]
    IMP -->|runImport| Pipeline[POST/GET /v1/imports]
    IMP -->|set importedFirst| AS
~~~

`onboardingChecklist` is a tiny module (`lib/onboarding-checklist.ts`): three async flag helpers plus one
**pure** `checklistState()` reducer — the only genuinely testable unit here.

---

# APIs

**No new endpoints.** Onboarding consumes existing Cleanup contracts only:

- `GET /v1/cookbooks` — checklist item 3 (already used by `RecipesScreen`).
- `POST /v1/imports` + `GET /v1/imports/:id` — the web and sample imports (via `lib/api/imports.runImport`).
- `GET /v1/recipes/:id` — preview after import.
- `GET /v1/recipes` (owned by **Meal Planning**, decision #1) — **not consumed by onboarding**; item 1
  completion is a local flag, not a server recipe count. Noted so reviewers don't wire a dependency we
  don't need.

---

# Testing

Mobile has **no test runner today** (server uses Vitest; there is no RN/Jest setup and no `*.test.tsx`).
Per the sprint convention, screens are verified by **demo-each on the simulator**; automated coverage is
limited to what is both offline and worth a runner.

## Test Coverage

| Use Case | Type | Unit | Integration | E2E |
|---|---|---|---|---|
| F-01 checklist completion | Flow | x (reducer) | | demo |
| F-02 add-recipe routing | Flow | | | demo |
| F-03 import from web | Flow | | | demo + existing server e2e |
| F-04 sample import | Flow | | | demo + existing server e2e |
| F-05 shortcut carousel | Flow | | | demo |

## Test Approach

### Unit Tests
The one non-trivial pure function is `checklistState(flags, cookbookCount)`. Its truth table (each item
done / not, `allDone`) is the smallest thing that breaks if the completion logic regresses. It needs no
network and no React. **Because there is no mobile runner, this test lands only if the wave stands up a
Vitest config for `lib/` (a ~10-line `vitest.config` with the RN-free path); otherwise the reducer is
verified in the F-01 demo.** Recommend the tiny config — the reducer is money-path (it decides whether a
user ever sees the checklist).

### Integration / E2E
No onboarding-specific server tests — onboarding adds no server code. **Try with a sample recipe** relies
on the **existing** `server/tests/e2e/{pinterest,tiktok,instagram,youtube}-import.test.ts`, which already
import the exact URLs this feature hardcodes — a green e2e run proves the samples still resolve. `npm test`
never hits the network; the sample URLs' canary is the opt-in `npm run test:e2e`.

## Test Infrastructure
Optional: a minimal `vitest.config.ts` scoped to `lib/` so pure client logic (this reducer, and future
ones) is unit-testable without a full RN test harness. Nothing else.

---

# Deployment

## Migrations
**None.** No schema or data changes. (`main` is at migration 0008; this task adds no 0009.)

## Deploy Sequence
Ships with the app bundle. Independent of the other Wave-2 tasks — it has no server surface to collide
with. It *reads* `GET /v1/recipes` from Meal Planning only conceptually; in practice it does not call it,
so there is no ordering constraint.

## Rollback Plan
Pure client rollback: revert the app changes. No migration to unwind, no server state to reconcile. Local
`AsyncStorage` flags are inert if the checklist code is removed.

---

# Monitoring

Instrumentation is a **separate task** (client-only Mixpanel, decision #5, NO-OP until a token is set).
Onboarding does not build the SDK; it only fires events through the shared `Button` primitive and the
onboarding-step helper. Events these screens emit:

| Name | Type | Use Case | Description |
|---|---|---|---|
| Onboarding Step Completed | event | F-01 | fired when an item flips to done (props: `step`, one of import/shortcut/cookbook) |
| Screen Viewed | event | F-02/04/05 | add-recipe sheet, platform screen, shortcut carousel |
| Button Tapped | event | F-02/03/04 | auto from `Button` (props: `label`, e.g. Open Instagram, Try sample) |
| Recipe Import Started | event (named domain) | F-03/F-04 | props: `source` (web/pinterest/tiktok/instagram/youtube), `via` (paste/sample) |

No alerts, dashboards, or server logs — there is no server path to monitor.

---

# Decisions

## Checklist completion is device-local, not server-derived
**Framework:** Direct criterion — truthfulness vs. cost.
Item 2 ("unlock faster importing") can never be server-verified (we cannot detect an iOS favorite), so a
server model could only ever be partial. Items 1 and 3 have cheap local signals (first-import side effect;
the cookbook list already fetched on this screen). A local model is honest for all three and adds no
endpoint or migration.
**Choice:** `AsyncStorage` booleans for import + shortcut; `cookbooks.length > 0` for cookbook — exactly
decision #Onboarding.
### Alternatives Considered
- **Server `onboarding_checklist` columns:** rejected — a migration + endpoint for state that is
  per-device by nature (the shortcut is a device setting) and re-derivable.
- **Derive item 1 from `GET /v1/recipes` count:** rejected — couples onboarding to Meal Planning's
  endpoint for a signal we already get free at import time.

## The social share path ships as coaching UI only
**Framework:** Direct criterion — the enabling dependency (Share Extension) is out of scope (decision #3).
Without the extension Harvest cannot appear in the iOS share sheet, so a "real" share-back is impossible
this wave. Building illustrated carousels + a real sample import delivers the *learning* and a *real first
recipe* without the extension.
**Choice:** "Open {app}" deep-links; carousels + shortcut steps are illustrations; sample import is the
working path. The shortcut carousel's final CTA is structured so a later wave can swap the illustration
for a live share sheet with no redesign.
### Alternatives Considered
- **Block the social item until the extension exists:** rejected — the checklist would ship visibly broken.
- **Fake a Harvest tile in a simulated iOS sheet (like the onboarding `ImportDemoCard`):** rejected for
  the *setup* carousel — teaching a gesture that does not yet work risks confusing users at the share
  sheet; illustrations framed as "here's what it will look like" are honest. (The existing in-onboarding
  demo stays as-is; it is a pre-signup teaser, not a live instruction.)

## Try-with-a-sample-recipe = a real import of a fixed per-platform URL
**Framework:** Direct criterion — prove the pipeline, give a real artifact.
A canned insert would complete the checklist without exercising import; a real import of a known-good URL
shows the genuine importing → preview → save flow and leaves the user a real recipe.
**Choice:** hardcode one URL per platform from `server/tests/e2e/*` (Pinterest = Jamaican Jerk Chicken,
TikTok = Creamy Garlic Paprika Chicken, Instagram = Peruvian chicken, YouTube = Buffalo Chicken Hot
Pockets). Web sample (if offered) = the Half Baked Harvest JSON-LD page.
### Alternatives Considered
- **Canned/pre-seeded recipe:** rejected — hides import failure and feels fake.

## iOS-share-sheet illustrations may use pure white
**Framework:** Direct criterion — the sanctioned exception in `AGENTS.md`.
The shortcut carousel's step art mimics the real iOS share sheet, which is white on the user's device.
Per the "one exception" rule (like the notifications-permission mock), these OS-mimicking illustrations
stay white; **every Harvest surface around them still obeys the rule** — the carousel sheet is `bg-cream`,
its rows/cards `bg-card`, never `bg-white`.

## Four platforms, checklist replaces the empty state
Pinterest/TikTok/Instagram/YouTube (backend fetchers + e2e), no Facebook (decision #3). The "Let's get
cooking!" checklist card **replaces** the current empty-state art on `RecipesScreen` and sits above the
Cookbooks grid; it collapses (chevron) and auto-collapses struck-through once all three items are done.

---

# Open Questions

| ID | Question | Status | Resolution |
|---|---|---|---|
| Q-01 | Does the Add-a-recipe entry replace the existing FAB menu (Import-from-a-link / Add-a-cookbook), or sit alongside it? | open | Recommend replace: FAB → the new Add-a-recipe sheet (social/web); "Add a cookbook" moves into that sheet or stays as a secondary row. Confirm at Architect review. |
| Q-02 | Should "Import from web" also offer a "Try with a sample recipe" (the Half Baked Harvest URL), or is the sample only on social platform screens? | open | Recommend social-only, matching Recime; web already has a paste field. |
| Q-03 | Once all three items are done, does the card stay (struck-through, collapsed) forever or get a one-tap dismiss? | open | Recommend collapsed-and-struck-through, no destructive dismiss (matches Recime; low stakes). |
| Q-04 | Do we stand up the minimal `vitest.config` for `lib/` so `checklistState` gets a unit test, or verify it in the demo only? | open | Recommend the tiny config — completion logic is money-path. |

---

# Risks

1. **The social carousels teach a gesture that does nothing yet.** Until the Share Extension ships,
   Harvest is absent from the iOS share sheet — a user who follows the carousel and shares from Instagram
   finds no Harvest tile and concludes the app is broken. This is the top risk, and it is a copy decision:
   frame the carousels and shortcut as "here's how it will work," and lead with the paths that work today
   (paste link, sample import). (Item 1 flipping on the *sample* import is intended — the user still gets
   a real recipe.)
2. **Sample URLs rot.** The hardcoded per-platform URLs can go dead or change content; the existing e2e
   suite is the canary but only when run. Mitigation: keep the four URLs in one constants file; a dead
   sample degrades to the normal import-failed screen (already handled), not a crash.
3. **Local-only completion resets on reinstall / new device.** A returning user (post Phone-Auth
   sign-in on a new device) sees the checklist again even if they've imported before. Acceptable
   (low-cost re-nudge); flagged in case the founder wants server-backed state later.
4. **Boundary with Phone Auth.** The checklist assumes an authenticated user; it lives *after* Phone
   Auth's name/phone step. If Phone Auth changes the post-signup landing route, the checklist's first
   appearance must still be on `RecipesScreen`. Coordinated, not owned here.

---

# Appendix A — Changelog

| Date | Author | Change |
|---|---|---|
| 2026-08-07 | Onboarding Lead | Initial draft, built to WAVE2-DECISIONS.md |
