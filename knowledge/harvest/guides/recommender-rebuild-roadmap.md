---
type: guide
description: Sequencing roadmap for replacing the recommender core with the embedding model.
status: active
created: 2026-09-10
last_verified: 2026-09-10
tags:
  - roadmap
  - recommendations
  - planning
---
# Recommender Rebuild — Roadmap

*The sequencing plan for replacing the recommender core with the embedding model. It coordinates three docs: the [course/form split spec](../specs/split-course-facet/spec.md) (a blocker), the [eval harness proposal](../proposals/recommender-eval-harness.md) (how we measure), and the [embedding model proposal](../proposals/embedding-recipe-similarity.md) (the model under test). Terminology lives in the [evaluation glossary](./recommender-eval-glossary.md).*

**Dependency spine:** the facet split unblocks Tier 1 → coverage backfill makes it rich → the harness + Tier 1 give a daily loop → the embedding model is built against that loop → Tier 2 anchors trust → ship. Corpus sourcing runs alongside and gates the embedding build.

```mermaid
flowchart LR
  P0["Phase 0 — split + backfill"] --> P1["Phase 1 — harness + Tier 1"]
  P1 --> P2["Phase 2 — embedding model"]
  S["Phase 1.5 — corpus to 30k"] --> P2
  P2 --> P3["Phase 3 — Tier 2 gold set"]
  P3 --> P4["Phase 4 — ship"]
```

## How to execute this (start here)

If you are an agent picking up this work, this document is your entry point — derive the order from the dependency table below; do not ask for it.

1. **Work one spec at a time, in dependency order.** From the table, pick the next spec whose dependencies are all done *and* that has a **full triple** (`spec.md` + `plan.md` + `tasks.md`). Implement that triple in order: `spec.md` (what/why) → `plan.md` (approach) → `tasks.md` (checklist).
2. **Start with [`split-course-facet`](../specs/split-course-facet/spec.md)** — no dependencies, blocks the rest. [`eval-harness-core`](../specs/eval-harness-core/spec.md) is also dependency-free, so it can proceed in parallel.
3. **Do not implement the lean specs** (`corpus-sourcing`, `embedding-recommender`, `tier2-gold-set`, `ship-recommender-swap`) yet — they are scoped but have no `plan`/`tasks`, and their dependencies are unmet. When one becomes next, its plan + tasks must be written first (stop and flag).
4. **Follow [`server/CLAUDE.md`](../../../server/CLAUDE.md)** throughout — Zod domain models, Drizzle migrations-only, `static create()` wiring, and the testing rules. A spec is done only when its `tasks.md` "Done when" holds and the full suite is green.

## Work breakdown (specs)

Each unit is a spec in `specs/`; order is derivable from **Depends on**. "Ready" = actionable now.

| Phase | Spec | Depends on | Fidelity | Ready? |
|---|---|---|---|---|
| 0.1 | [split-course-facet](../specs/split-course-facet/spec.md) | — | full triple | ✅ now |
| 1.3 | [eval-harness-core](../specs/eval-harness-core/spec.md) | — | full triple | ✅ now (parallel) |
| 0.2 | [facet-coverage-backfill](../specs/facet-coverage-backfill/spec.md) | 0.1 | full triple | after 0.1 |
| 1.4 | [tier1-metadata-eval](../specs/tier1-metadata-eval/spec.md) | 0.1, 0.2, 1.3 | full triple | after deps |
| 1.5 | [corpus-sourcing](../specs/corpus-sourcing/spec.md) | categorizer | lean | founder-gated |
| 2 | [embedding-recommender](../specs/embedding-recommender/spec.md) | 1.3, 1.5 | lean | needs plan+tasks |
| 3 | [tier2-gold-set](../specs/tier2-gold-set/spec.md) | 1.3, 1.4, 2 | lean | needs plan+tasks |
| 4 | [ship-recommender-swap](../specs/ship-recommender-swap/spec.md) | 2, 3 | lean | needs plan+tasks |

## Phase 0 — Foundations (unblocks everything)

1. **Ship the course/form split** — add the `course` facet, reduce `dish_type` to forms, migrate existing rows, simplify `course.ts`.
2. **Audit and backfill coverage** — measure `cuisine` / `dish_type` coverage, then re-run the categorizer over the gaps (post-split, so it writes clean facets).

→ *Exit:* `course` and `dish_type` are clean and orthogonal; coverage of both is measured and maximized.

## Phase 1 — Harness + Tier 1 (the daily loop)

3. **Build the harness** — the `rank(recipeId)` interface, today's IDF similarity wrapped behind it, and the random + popularity baselines.
4. **Build Tier 1** — generate triplets from cuisine + dish form; add the triplet-accuracy scorer, the rare-ingredient probe, and the known-answer probes.

→ *Exit (harness self-test):* `random < popularity < IDF` holds — the metric is trustworthy, and the 30-second loop is live.

## Phase 1.5 — Corpus sourcing (founder-gated; blocks Phase 2)

The embedding model needs co-occurrence density: PMI estimates only converge to the true distribution with enough well-spread data, and the rare tail converges slowest. Three steps, human in the loop:

5. **Measure** — the per-ingredient / per-pair distribution; report the gap to the density rule (the ~200th-most-common ingredient still appears in 30+ recipes).
6. **Source to ~30k** — founder-directed, from vetted sources; coverage across cuisines beats raw count.
7. **QA together** — before new recipes enter the corpus, jointly confirm the spread, that ingredients parse, and that facets categorize.

→ *Exit:* the density rule holds on a quality-checked corpus, with explicit sign-off.

## Phase 2 — The model under test

8. **Build the embedding model** (PMI → SVD → SIF pooling) behind the same interface, and iterate it against Tier 1 daily.

→ *Exit:* embeddings beat IDF on Tier 1 and the rare-ingredient probe drops well below IDF's.

## Phase 3 — Tier 2 (the trust anchor)

9. **Mine** the max-disagreement IDF-vs-embedding pairs and **LLM-draft** each label.
10. **Build the review portal;** a human corrects the drafts into the checked-in gold set.
11. **Score and validate** — Precision@10 / nDCG@10 on the gold set, then the Tier 1↔Tier 2 Spearman check.

→ *Exit:* high ρ — Tier 1 is a validated daily proxy (or the proxy is fixed before we lean on it).

## Phase 4 — Ship

12. With embeddings winning on both tiers and the regression probe fixed, **swap the recommender core.** Leave the Tier 3 behavioral slot for post-launch.

## Who does what

The split, harness, Tier 1, embedding code, Tier 2 tooling, and portal are mine to build. **Corpus sourcing and quality sign-off (Phase 1.5) are founder-gated** — sourcing direction and the QA pass are yours. Phase 1.5 is the long pole, so it starts alongside Phase 0/1; nothing in 0/1 waits on it.
