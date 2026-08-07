# Spec 01 — Drop ingredient section/category labels (never steps or ingredients)

## Story
Some recipes group ingredients under headers like "For the base" or "To finish". These leak into
the recipe as **steps** or **ingredients**. Drop bare section/category labels; steps must contain
only real cooking instructions.

**Repro:** https://youtu.be/79gZLSXINAU (YouTube — "To finish", "For the base").

## Root cause
Two extraction paths produce a recipe: JSON-LD (`server/src/fetch/website.ts`) and the LLM extractor
(`server/src/parse/extractor.ts`). `mapInstructions` already skips `HowToSection` names, so the leak
is the LLM emitting spoken/written headers as steps/ingredients. Every source funnels through
`toRecipeInput` in `import-pipeline.ts` before persistence — the single chokepoint to clean.

## Fix
1. **Prompt** (`extractor.ts SYSTEM_PROMPT`): add — never output an ingredient section header
   (e.g. "For the base", "To finish", "For the sauce") as a step or an ingredient; omit them.
2. **Deterministic safety net** — a pure `isSectionLabel(text)` + `stripSectionLabels(list)`,
   applied to `steps` and `ingredients` in `toRecipeInput`. Conservative so it never drops a real
   line: only a short (≤6 words), digit-free line that is front-anchored `for the …` /
   `to (finish|serve|assemble|garnish|…)` or ends with `:`.

## Files
- `server/src/parse/extractor.ts` — prompt line.
- `server/src/pipeline/import-pipeline.ts` — `isSectionLabel` / `stripSectionLabels`, call in `toRecipeInput`.
- `server/tests/unit/import-pipeline.test.ts` — unit tests for the filter.

## Tests
- `isSectionLabel` true: "For the base", "To finish", "For the sauce:", "the topping".
- `isSectionLabel` false (real content kept): "To finish, stir in the parmesan and serve" (>6 words),
  "Season the base with 2 tsp salt" (has digit / not a header), "Fresh basil to garnish", "Salt to taste".
- `stripSectionLabels(["For the base","Sear the chicken 3 min","To finish"])` → `["Sear the chicken 3 min"]`.

## Acceptance / verify (live)
Re-import 79gZLSXINAU on the running server: no step or ingredient equals a bare "For the base" /
"To finish"; the real steps/ingredients remain. Add a step-content assertion to the YouTube e2e
`transcript` case.
