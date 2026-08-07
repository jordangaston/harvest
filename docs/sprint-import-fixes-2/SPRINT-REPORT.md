# Sprint Report — Recipe Import Fixes 2

Third import sprint. Six feedback stories, all fixed and verified against their real reproduction
links on the running server in the iOS simulator. 80 server tests green; app + server typecheck clean.

## Outcomes

| # | Story | Status | Proof |
|---|-------|--------|-------|
| 1 | Ingredient section labels ("For the base", "To finish") must not become steps or ingredients | ✅ Done | `smokinandgrillinwitab.com/marry-me-tuscan-chicken-soup` raw JSON-LD has 19 ingredients incl. both labels → import returns **17, labels gone**. `story-01-no-section-labels.{mp4,png}` + 4 unit tests |
| 2 | Website instructions must split into discrete steps | ✅ Done | HBH croissant french toast: 1 garbled step → **7 discrete ordered steps**, no embedded "N." markers. `story-02-website-steps.{mp4,png}` + unit + `website-import.test.ts` e2e |
| 3 | Instagram carousels must capture instructions, not just ingredients | ✅ Done | IG `DRxXRvVD6wQ` → **5 recipes, all with steps** (8,6,6,8,8); opened one in-app → 11-step method. `story-03-carousel-steps.{mp4,png}` + 2 unit tests + e2e steps assertion |
| 4 | Multi-recipe carousel: set the cookbook per recipe | ✅ Done | Steak Sandwich → **Dinner**, Chicken Pasta → **Quick**, each from a per-card save. `story-04-per-recipe-cookbook.{mp4,png}` |
| 5 | Remove the "Now you're cooking!" save modal | ✅ Done | Save → **no modal**, lands on Recipes with a "✓ Saved to <cookbook>" toast. Component deleted. `story-05-save-toast.mp4` + `story-05-toast-frame.png` |
| 6 | Fix three low-contrast surfaces (WCAG AA, tokens) | ✅ Done | Edit button, add-recipe modal, save-to-cookbook modal reworked per /practical-ui. `before-/after-06{a,b,c}-*.png` |

## How each was fixed (root cause, not symptom)

- **1 — one shared filter, not per-caller.** Every source persists through `toRecipeInput`, so a
  conservative `stripSectionLabels` there (and a prompt line for the LLM path) covers website JSON-LD,
  captions, and carousels at once. Guard rails: ≤6 words, digit-free, front-anchored — so the real
  step "To finish, stir in the cream…" and the ingredient "Fresh basil to garnish" survive.
- **2 — explode a collapsed blob.** HBH (WP Recipe Maker) ships the whole method as one `HowToStep`
  numbered "1. … 2. …". Split on the `N.` markers (normalizing a period glued to the next marker),
  else on sentences; proper HowToStep arrays are left alone.
- **3 — the reader, not the gate.** Tesseract half-reads dense stylized IG cards (it returned 0 chars
  on one slide), yielding ingredients-with-no-steps. Fix: keep Tesseract as the fast primary and
  escalate only that failure to the Qwen-VL VLM, re-reading the one card. This recovers steps without
  the recipe-dropping that reading every slide with the VLM caused (11 parallel calls > the model's TPM cap).
- **4 — reuse the pattern.** Each carousel page got the single-recipe screen's own "Save to cookbook"
  button + the existing picker, scoped to one recipe — no new concept, and no misleading single
  "save all" destination.
- **5 — a read-once signal.** Deleted `SuccessCelebration`; the save flow stashes the cookbook name in
  a tiny module the Recipes tab reads on focus and shows as a toast.
- **6 — tokens and weight.** Filled `bg-brand` primary, outlined `border-brand` secondary, lifted
  `bg-cream`/`bg-brand-light` selectable tiles — never `bg-white`, all AA.

## What went well

- **Verifying against live reality caught two wrong turns.** Story 3's bug didn't reproduce (both
  readers currently succeed), and the "obvious" all-Groq fix silently dropped 2 of 5 recipes under the
  real TPM cap — only visible because I ran the real import, not the sequential diagnostic. The final
  escalation design is both more correct and cheaper.
- **The pre-mortem paid for itself.** It flagged the picker `onSaved` signature break, the "never empty
  a list" guard, and the front-anchored regex — all folded before writing code.
- **Driving the real app surfaced two carousel-only bugs** (picker `selected`/`busy` carrying over
  between recipes) that no unit test would have caught, because the carousel reuses one picker instance.

## What to improve

- **Shared component state across a reused instance is a trap.** The picker was written for a
  mount-per-use screen; reusing it in the carousel exposed leaked `selected`/`busy`. A reset-on-open is
  the fix, but the smell is state that outlives its intended scope.
- **Toast delivery across a stack→tab boundary is fiddly.** The route-param approach looked simplest
  but raced its own timer; a module signal was the honest choice. Worth a small shared "flash message"
  helper if more of these appear.
- **Demo capture of transient UI needs video, not screenshots.** A 2.6 s toast is unhittable with
  discrete screenshots; extract the frame from a recording instead.

## Follow-ups before ship

- **Section-label filter is a heuristic.** It targets English grouping phrases; a recipe that starts a
  real step with "For the sauce, …" in ≤6 words with no digit would be dropped. Low risk, but a
  richer signal (position, trailing colon + following block) would be safer at scale.
- **Carousel escalation adds a VLM call per steps-less card.** Fine at current volumes; if carousels
  get large or Groq quotas tighten, bound the escalation count and log what was skipped.
- **YouTube import is non-deterministic** (the same link resolves via different sources run to run) —
  worth pinning the source path for reproducible tests.
- **No `before-06c` screenshot** (the picker before-state needs preview mode); the after and the code
  diff document the change.
