# Onboarding Improvements — reference analysis (CLARIFY gate)

Source: `~/Desktop/Business/Harvest/onboarding-improvements.MP4` (Recime, 75s, iPhone screen
recording) + the current Harvest code. This documents the Recime flow to emulate, where we
diverge, and the state of what already exists. No design/spec here — that's the DESIGN gate.

## The Recime flow (frame-by-frame)

**Recipes/home screen with the onboarding checklist**
- Header: wordmark, a "4 left" credit pill (Recime's free-import quota — **we have no credits, omit**),
  avatar icon (Profile task owns the avatar).
- A **"Welcome — Let's get cooking!"** card sits *above* the Cookbooks list, with a chevron to
  collapse it. Inside, a 3-item checklist, each a row (icon + label + `›`):
  1. **Import your first recipe**
  2. **Unlock faster importing** (clock icon)
  3. **Create your first cookbook** (book icon)
- A completed item renders **strikethrough + a filled check**; the row stops being tappable.
  Once all three are done the card stays but fully struck through (collapsible/removable).
- Below: `Cookbooks ⌄` section, cookbook grid ("Mains · 1 Recipe"), `+` FAB.

**"Import your first recipe" → "Add a recipe" sheet**
- Recime shows 5 options: a big **"Import from social media — Share to ReciMe from social apps"**
  card, then Import from photo, Import from text, Import from web, Write from scratch.
- **We diverge:** only **Import from social media** + **Import from web** (our backend imports from a
  URL only — no OCR-photo, no manual entry).

**"Import from social media" sheet** — a list of platform rows.
- Recime: Instagram / TikTok / Facebook.
- **We diverge:** **Pinterest / TikTok / Instagram / YouTube** — the four our backend actually fetches
  and that `server/tests/e2e/*` covers. No Facebook (no fetcher).

**Per-platform screen ("Import from Instagram/TikTok/…")**
- A mock post card (recipe photo + social action bar) with a **swipeable carousel** of hand-lettered
  coach slides walking the share path: *tap send → tap share-to → tap ReciMe → done* (TikTok: *tap
  send → tap more*). Carousel dots below.
- Primary button **"Open {Platform} to find a recipe"** → shows a "Launching {Platform}…" splash, then
  deep-links into the real native app.
- Secondary link **"Try with a sample recipe."**

**"Unlock faster importing" → share-shortcut setup carousel**
- Intro slide: illustration of the iOS share sheet with ReciMe highlighted, **"Save recipes faster 🚀 —
  Add ReciMe to the share menu … so saving any recipe takes just one tap,"** button **"Add the shortcut."**
- Then a 5-step carousel, each = a mock iOS screenshot + hand-lettered arrow + a **"Set it up"** button
  that invokes the **real** iOS share sheet so the user performs the step on their device:
  1. Share sheet → scroll right → **tap More**
  2. **Tap Edit** (top-right of the activities list)
  3. Find ReciMe → **tap the + button** (adds to Favorites)
  4. **Drag ReciMe to the top**
  5. **Tap Done**
- Marks item 2 complete.

## What already exists in Harvest (verified in code)

- **`app/(app)/recipes.tsx`** is today a **Cookbooks** screen. **No checklist exists yet** — the empty
  state is "Let's get cooking!" art + an FAB whose sheet offers "Import from a link" / "Add a cookbook."
  This screen is where the checklist card must be added (replacing/wrapping the empty state).
- **`app/import.tsx`** — the paste-a-link screen ("Import from web" equivalent). Works: routes to
  `app/importing.tsx` → `runImport(url)` (the real pipeline) → preview/recipe. **This is the one
  import path that works end-to-end today.**
- **`app/import-source.tsx`** — a thin per-platform screen: a static mock post, **"Open {source}"**
  (deep-links via `APP_SCHEMES`, only IG/TikTok/Facebook wired), **"Try with a sample recipe"** that
  routes to `/importing` **with no URL → it currently fails.** No carousel yet.
- **`app/(onboarding)/import-demo.tsx`** + **`components/recime/ImportDemoCard.tsx`** — a **fully
  simulated** in-app share demo (mock post → mock share sheet with a fake "Harvest" tile → fake
  "Importing…"). It never touches the real iOS share sheet. Good visual reference; not a real import.
- **No `ios/` directory, no share-extension / share-intent Expo plugin, no `Linking`-to-us handler.**
  Managed Expo app (`app.json` only).
- **No default cookbook is seeded at signup** (verified: `POST /v1/users` → `users.createUser`, no
  cookbook creation). A new user has **0 cookbooks** → "Create your first cookbook" is honestly
  incomplete and derivable from the cookbook count already fetched on this screen.
- **`GET /v1/recipes` is not exposed** (only `RecipeRepository.listOwned` exists) — so "has ≥1 recipe"
  can't be read from the server today without exposing an endpoint.

## The load-bearing constraint

Every "share to Harvest from Instagram/TikTok/…" path — and the entire "Unlock faster importing"
shortcut — depends on **Harvest appearing in the iOS share sheet**, which needs a **native iOS Share
Extension**. That extension is **out of scope** (managed Expo app; memory + repo confirm it was never
built). So in this wave the social carousels and the shortcut-setup are **instructional UI**; the only
imports that actually complete are **paste-a-link ("Import from web")** and **"Try with a sample
recipe."** This drives Q1 below and colours Q2/Q5.

## Real sample-recipe URLs (from `server/tests/e2e/*`, for "Try with a sample recipe")

| Platform  | Sample URL | Recipe |
|-----------|-----------|--------|
| Pinterest | `https://pin.it/6S1Z5sKLl` | Jamaican Jerk Chicken |
| TikTok    | `https://www.tiktok.com/t/ZTAsQBAYX/` | Creamy Garlic Paprika Chicken |
| Instagram | `https://www.instagram.com/reel/DYmyAAaMDBj/` | Peruvian chicken |
| YouTube   | `https://youtube.com/shorts/JESPUqVMJpU` | Buffalo Chicken Hot Pockets |
| Web       | `https://www.halfbakedharvest.com/strawberry-and-cream-stuffed-croissant-french-toast/` | (Tier-0 JSON-LD) |

## Divergences from Recime (decided by brief/stack — not open questions)
- Drop the "N left" credit pill (no quota model).
- 4 social platforms (Pinterest/TikTok/Instagram/YouTube), not 3 (IG/TikTok/Facebook).
- Add-recipe sheet = 2 options (social + web), not 5.
- Golden-hour design tokens, not Recime's blue/white; sheets `bg-cream`, rows `bg-card`; Lora/Karla;
  motion via `lib/motion.ts`; honour Reduce Motion (per `AGENTS.md`).
