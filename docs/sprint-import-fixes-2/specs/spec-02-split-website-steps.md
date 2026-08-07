# Spec 02 — Website instructions split into discrete ordered steps

## Story
A website import returns the whole method garbled onto a single step. Parse JSON-LD
`recipeInstructions` into separate, ordered steps.

**Repro:** https://www.halfbakedharvest.com/strawberry-and-cream-stuffed-croissant-french-toast/
— today it comes back as one garbled step.

## Root cause (CONFIRMED via live fetch)
HBH emits `recipeInstructions` as a SINGLE `HowToStep` whose `.text` is the entire numbered method:
`"1. Preheat the oven to 375° F… 2. In a large shallow dish… 3. … 7. …"`. `mapInstructions` pushes
it as one step → garbled.

## Fix (`server/src/fetch/website.ts`)
Keep the existing HowToStep/HowToSection walk. Then:
- If the walk yields exactly ONE step, `explodeStep` it: split on embedded numbered markers
  (`\s(?=\d+\.\s)`, ≥2 markers) stripping the `N.` prefix; else, if it's long, split on sentence
  boundaries (`(?<=[.!?])\s+(?=[A-Z])`). Return the pieces.
- If the walk yields ≥2 steps, still numbered-split any individual step that embeds a numbered list;
  leave already-segmented short steps untouched (don't re-split proper HowToStep arrays).

`\d+\.\s` won't split "2 tablespoons" (no dot) or "375° F" — only "N. " list markers.

## Files
- `server/src/fetch/website.ts` — `explodeStep` / `numberedSplit`, wire into `mapInstructions`.
- `server/tests/e2e/website-import.test.ts` — NEW live e2e for the HBH URL (user-requested).

## Tests
- `mapInstructions` on one blob `"1. A. 2. B. 3. C."` → `["A.","B.","C."]`.
- `mapInstructions` on a proper 3-item HowToStep array (short texts) → unchanged 3 steps.
- e2e (live): import the HBH URL → `steps.length >= 5`, first step mentions preheat/375, no step
  contains the literal "2." mid-text.

## Acceptance / verify (live)
Import the HBH URL on the running server → ~7 discrete ordered steps (Preheat…, whisk…, slit…, fill…,
brush+bake…, butter+bake…, toss berries+serve). Passing new e2e.
