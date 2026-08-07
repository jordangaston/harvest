# Spec 03 — Instagram carousels must capture instructions, not just ingredients

## Story
Importing a slideshow yields recipes with ingredients but no steps. Fix the root cause so carousel
recipes include their cooking steps.

**Repro:** https://www.instagram.com/p/DRxXRvVD6wQ/?img_index=10 (none of these recipes have instructions).

## Root cause (CONFIRMED via live import + per-slide diagnostic)
Each recipe is ONE self-contained dense card slide (evens 2,4,6,8,10; ocrLen 1600-2300 with ingredients
+ method). Odd slides are dish-photo/title slides (short, correctly gated by `CAROUSEL_RECIPE_MIN_CHARS
= 800`). `readSlideRecipe` OCRs each slide with **Tesseract**, which is UNRELIABLE on these stylized
cards — it failed slide 3 entirely (ocrLen=0). When Tesseract reads a card's clean ingredient list but
garbles/misses the method paragraph, the extract yields title+ingredients+**no steps**, which passes
`hasRecipe` (title + ≥1 ingredient) and persists steps-less. That is the reported "ingredients but no
steps." (The bug did not reproduce on the live link today — both readers currently succeed — but the
Tesseract failure proves the fragility.)

## Fix (`server/src/parse/vision.ts` + `server/src/pipeline/import-pipeline.ts`)
Read carousel slides with **GroqVision (Qwen-VL)** — already wired + keyed; the `vision.ts` comment
invites the swap. Diagnostic on the live repro: Groq read all 5 recipe cards WITH steps, zero errors,
no rate-limit issue on 11 parallel calls.
- `vision.ts`: add `selectSlideVision()` → `StubVision` under test, `GroqVision` when `GROQ_API_KEY`
  present, else the Tesseract reader (offline fallback).
- `import-pipeline.ts`: `readSlideRecipe` uses the slide reader; keep the 800-char length gate (short
  slides otherwise hallucinate — Groq invented 7 steps from a 59-char title slide). Video-frame reads
  stay on Tesseract (12 frames; Groq caps images/request).

## Files
- `server/src/parse/vision.ts` — `selectSlideVision()`.
- `server/src/pipeline/import-pipeline.ts` — carousel slide reader; length gate unchanged.
- `server/tests/e2e/instagram-import.test.ts` — assert steps present on carousel recipes.

## Tests
- Live e2e: import DRxXRvVD6wQ → recipes returned and (most/all) have `steps.length > 0`.
- Verified live in the running server.

## Acceptance / verify (live)
Re-import the IG carousel on the running server → recipes carry cooking steps (not just ingredients).
