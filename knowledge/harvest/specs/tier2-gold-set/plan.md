---
type: spec-plan
description: "Plan for the Tier 2 human gold set: mine, draft, portal, graded metrics + Spearman."
parent_spec: tier2-gold-set/spec
created: 2026-09-11
author: jordangaston
tags:
  - spec
  - plan
---
Plan for [tier2-gold-set spec](./spec.md).

## Approach

Build the automatable machinery around the one human step. The graded metrics and the mining are pure/testable and land first; the LLM draft and the review portal are the human-in-the-loop tooling; the human correction pass (and thus the final P@10/nDCG@10 + Spearman numbers) is founder-gated. Both models exist and measurably disagree ([embedding](../embedding-recommender/spec.md) 0.877 vs IDF 0.774 on Tier 1), so mining has real signal to work with.

## Phases

1. **Graded metrics** (pure) — `precisionAtK`, `ndcgAtK`, `spearman`, and a graded `evaluate` over a labeled gold set. Unit-tested against hand-computed values.
2. **Mine** — `labels:mine`: for a sample of anchors, union each model's top-N, score each candidate by rank disagreement `|rank_idf − rank_emb|`, keep the most-disagreeing per anchor → `eval/gold/candidates.jsonl`. These are the discriminating pairs worth a human's time.
3. **Draft** — `labels:draft`: the existing LLM client judges each candidate pair (0–3 similarity) → `drafts.jsonl`. A script (live LLM), run when labeling begins.
4. **Portal** — a local-first `tsx` Hono server on localhost: shows anchor + candidate recipes, Confirm / Flip / Skip, appends verdicts to `eval/gold/pairs.jsonl`. Hosted `adminGuard` route only if labeling goes multi-reviewer.
5. **Score + validate** — P@10 / nDCG@10 per model over `pairs.jsonl`; the Tier 1 ↔ Tier 2 Spearman that certifies Tier 1 as a daily proxy.

## Risks + unknowns

- **Human-gated** — the gold set (and final numbers) need the review pass; everything else is built ahead of it.
- **Sparse per-anchor labels** — nDCG@10 needs enough labeled candidates per anchor; mine top-M per anchor, not globally.
- **LLM draft bias** — drafts are a starting point the human flips, never the ground truth.
- **Spearman across few models** — with 3 models (random/idf/embedding) the model-level ρ is coarse; report the per-anchor correlation too.

## Dependencies

- [eval-harness-core](../eval-harness-core/spec.md), [tier1-metadata-eval](../tier1-metadata-eval/spec.md), [embedding-recommender](../embedding-recommender/spec.md) — all done.

## Rollout

Offline scripts + a localhost portal; commit `candidates.jsonl` / `pairs.jsonl`. No deploy.
