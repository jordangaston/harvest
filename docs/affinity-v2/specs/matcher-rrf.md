# Work-Item Specs — Matcher Accuracy (RRF hybrid retrieval)

Implements `docs/affinity-v2/matcher-accuracy-proposal.md`. Fixes the ~7.8% confidently-wrong matches by
fusing a word-level retriever with the existing trigram retriever (RRF) behind a fuzzy reject floor.

---

## WI-M1 — Word-level FTS retriever

**Goal.** A second, word-tokenised search over the FDC catalog, complementary to trigram.

**Acceptance criteria**
- Migration adds `fdc_foods_word_fts` (fts5, `tokenize='unicode61'`) mirroring
  `fdc_foods.description_normalized`, with insert/delete/update triggers matching `0002_fdc_fts.sql`,
  and a populate of existing rows.
- `FdcFoodRepository.searchWords(tokens)` OR-matches the tokens as words, returns `FdcFoodCandidate[]`
  by bm25 (best first); `[]` for no tokens/hits. A misspelled token (`spinnach`) returns nothing here.

**Files.** migration, `src/nutrition/fdc-food-repository.ts`. **Tests.** `nutrition-matching.test.ts`.

---

## WI-M2 — RRF fusion + fuzzy similarity (pure)

**Goal.** Combine ranked lists and score character similarity — both pure, unit-tested.

**Acceptance criteria**
- `rrfFuse(lists, k=60)` returns ids ordered by `Σ 1/(k + rank_i)`; a candidate ranked well in two lists
  beats one ranked #1 in a single list; deterministic; unweighted.
- `diceSimilarity(a, b)` = character-bigram Dice coefficient in `[0,1]`; `1` for equal, high for a
  one-letter typo (`spinnach`~`spinach`), low for merely trigram-similar different words (`cumin`~`cucumber`).

**Files.** `src/nutrition/retrieval/rrf.ts`, `src/nutrition/retrieval/similarity.ts`. **Tests.** new.

---

## WI-M3 — FoodMatcher: fuse → reject floor → tier

**Goal.** Replace top-1 bm25 with hybrid retrieval.

**Acceptance criteria**
- `match(name)`: `normalize` → trigram + word search → `rrfFuse` → take the fused top → **reject floor**:
  keep only if some ingredient token has `diceSimilarity ≥ FLOOR` with a food token; else `null`.
- Quality: `high` if the top is in the word results (exact-word agreement), else `medium`.
- Existing behaviour preserved: `fresh spinach`→high, `salmon fillet`→high, `spinnach`→non-null,
  gibberish→null.

**Files.** `src/nutrition/food-matcher.ts`. **Tests.** update `nutrition-matching.test.ts`.

---

## WI-M4 — Re-match + measure

**Goal.** Apply to the corpus and prove the drop.

**Acceptance criteria**
- Migrate the dev DB, re-run `backfill:fdc`, then `eval:matcher` (the zero-overlap proxy): error rate
  drops from 7.8% toward <2%; base-ingredient coverage stays > ~70%. Report before/after.
