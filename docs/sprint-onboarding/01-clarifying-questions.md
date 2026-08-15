# Onboarding Improvements — clarifying questions (each with a recommended answer)

Five decisions genuinely fork the build. Everything else has a sensible default (noted in
`00-reference-analysis.md`) and I'll just take it.

## Q1 — Share-to-Harvest needs a native iOS Share Extension that's out of scope. What actually ships?
The social carousels ("Open Instagram → tap share → Harvest") and the whole "Unlock faster importing"
shortcut only work if Harvest is in the iOS share sheet — a **native Share Extension**. This is a
managed Expo app with no `ios/` dir, no share plugin; the extension was never built and is out of scope.
**Recommendation:** Ship the full instructional UI to match Recime, but the only imports that complete
end-to-end this wave are **"Import from web" (paste a link)** and **"Try with a sample recipe."** The
per-platform **"Open {Platform}"** button deep-links into the native app (educational only), and the
"Unlock faster importing" carousel renders as coaching UI — its real-share-sheet tail is wired only if
the Share Extension ships later. Build the extension is **not** part of this task.

## Q2 — How is each checklist item marked complete, and where does state persist?
No `GET /v1/recipes` is exposed yet; item 2 can never be server-verified (we can't detect an iOS
favorite). **Recommendation:**
- **Import your first recipe** → local flag set on the first successful import (avoids a new endpoint).
- **Unlock faster importing** → local flag set when the user finishes the shortcut carousel.
- **Create your first cookbook** → derive from `cookbooks.length > 0` (already fetched on this screen;
  a new user has 0 — verified no default cookbook is seeded).
- Persist the two flags in AsyncStorage; a completed item shows strikethrough + check; the card is
  collapsible and stays (struck through) once all three are done. **Alternative if you want server
  truth for item 1:** expose `GET /v1/recipes` (thin; `listOwned` already exists) and derive count>0.

## Q3 — Confirm the four social platforms.
**Recommendation:** **Pinterest, TikTok, Instagram, YouTube** — the four our backend fetches and
`server/tests/e2e/*` covers. Drop Recime's Facebook (no fetcher). Diverges from the video (IG/TikTok/FB).

## Q4 — Confirm the "Add a recipe" options.
Recime shows 5 (social, photo, text, web, write-from-scratch). **Recommendation:** only **Import from
social media** + **Import from web** — our backend imports from a URL only (no OCR-photo, no manual entry).

## Q5 — What does "Try with a sample recipe" do?
**Recommendation:** Run a **real import** of a fixed per-platform sample URL from the e2e set (Pinterest
= Jamaican Jerk Chicken, TikTok = Creamy Garlic Paprika Chicken, Instagram = Peruvian chicken, YouTube =
Buffalo Chicken Hot Pockets) via the existing `runImport` pipeline → real importing→preview→save, which
also satisfies "Import your first recipe." Not a canned insert. Known ceiling: those live URLs can rot.
