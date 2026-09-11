---
type: spec-tasks
description: Task checklist for the Tier 2 gold set.
parent_spec: tier2-gold-set/spec
created: 2026-09-11
author: jordangaston
tags:
  - spec
  - tasks
---
Tasks for [tier2-gold-set spec](./spec.md).

## Tasks

- [ ] **Graded metrics** (pure) — `precisionAtK`, `ndcgAtK`, `spearman`; graded `evaluate` over a labeled gold set. Unit-tested.
- [ ] **Mine** — `labels:mine` (`scripts/mine-disagreements.ts`): max rank-disagreement IDF-vs-embedding candidates per anchor → `eval/gold/candidates.jsonl`.
- [ ] **Draft** — `labels:draft` (`scripts/draft-labels.ts`): LLM judges each candidate (0–3) → `drafts.jsonl`. Live LLM; run at labeling time.
- [ ] **Portal** — local Hono `tsx` review server: anchor + candidate cards, Confirm/Flip/Skip, append to `eval/gold/pairs.jsonl`.
- [ ] **Score + validate** — P@10 / nDCG@10 per model + Tier 1 ↔ Tier 2 Spearman, wired into `eval:recsys`.
- [ ] **Human pass** (founder-gated) — review ~200–300 pairs into the checked-in gold set.
- [ ] Tests: metric math, mining disagreement logic, portal verdict write; full suite green.

## Done when

- A human-corrected `pairs.jsonl` scores P@10 / nDCG@10 for every model, and the Tier 1 ↔ Tier 2 Spearman is high enough to certify Tier 1 as the daily proxy (or the proxy is fixed before we lean on it).

## Out of scope

- The embedding model; Tier 1; the ship cutover ([ship-recommender-swap](../ship-recommender-swap/spec.md)).
