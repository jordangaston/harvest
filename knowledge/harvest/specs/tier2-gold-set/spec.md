---
type: spec
description: Mine disagreements, LLM-draft, human-correct via a portal; score Precision@10/nDCG@10 + Spearman.
status: draft
owner: jordangaston
created: 2026-09-10
parent_proposal: recommender-eval-harness
tags:
  - spec
  - eval
  - recommendations
---
One-line: the human-corrected gold set — mine disagreements, LLM-draft, human-correct in a portal — plus graded metrics and the proxy-validation check.

*Part of the [Recommender Rebuild roadmap](../../guides/recommender-rebuild-roadmap.md) — Phase 3. Implements Tier 2 of the [eval harness proposal](../../proposals/recommender-eval-harness.md).*

> **Lean spec.** Full plan + tasks when Phase 3 starts — it needs two disagreeing models (IDF + [embedding-recommender](../embedding-recommender/spec.md)) to exist first.

## Goals

- Build the ~200–300-pair human-corrected gold set: mine max-disagreement pairs, LLM-draft each, human-correct into a checked-in `eval/gold/pairs.jsonl`.
- Score **Precision@10 / nDCG@10** on the gold set.
- Run the **Tier 1 ↔ Tier 2 Spearman** check that validates Tier 1 as a daily proxy.

## Non-goals

- The embedding model; Tier 1; the ship cutover.

## Design (sketch)

- **Mine** — `labels:mine`: max-disagreement IDF-vs-embedding pairs → `candidates.jsonl`.
- **Draft** — `labels:draft`: the existing LLM client answers each pair → `drafts.jsonl`.
- **Portal** — a local-first `tsx` review server (Hono on localhost): Confirm / Flip / Skip, writing verdicts to `pairs.jsonl` as it goes. Promote to a hosted `adminGuard` route only if labeling goes remote/multi-reviewer.
- **Score** — Precision@10 / nDCG@10 + the Spearman correlation across models.

*Exit:* high ρ — Tier 1 is a validated daily proxy.