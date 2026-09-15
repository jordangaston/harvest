---
type: guide
description: How offline recsys/search evaluation actually works — pooling, its limits, and why real engines rely on online eval.
status: active
created: 2026-09-15
last_verified: 2026-09-15
tags:
  - eval
  - recommendations
  - reference
  - methodology
---
# Recsys / Search Evaluation — Pooling, Its Limits, and Online Eval

*The methodology behind our [eval harness](../proposals/recommender-eval-harness.md): what our Tier 2 gold sets are an instance of, why the design is standard practice, where it's blind, and how production search engines get past those blind spots. Terms are in the [evaluation glossary](./recommender-eval-glossary.md); the concrete specs are [eval-harness-core](../specs/eval-harness-core/spec.md), [tier1-metadata-eval](../specs/tier1-metadata-eval/spec.md), and [tier2-gold-set](../specs/tier2-gold-set/spec.md).*

## Two questions any recommender eval is really asking

Keep these separate — most confusion comes from conflating them:

- **(A) Precision — "Is what it shows the user good, and are the best ones on top?"** Grades the model's actual output.
- **(B) Recall / absolute quality — "Out of the whole corpus, does it find the genuinely-best items, or miss gems it never surfaced?"**

Our Tier 2 `realtop` set answers **(A)**. It cannot answer **(B)** — and that is a deliberate, well-understood trade-off, not an oversight.

## The Cranfield paradigm (the foundation)

Modern offline evaluation traces to Cyril Cleverdon's Cranfield experiments (1960s): a **fixed collection** + a **set of queries** + **human relevance judgments** ("qrels") + a **metric** (precision/recall, later nDCG). Run each system, compare to the judgments, get a number. Everything below is a patch on this idea.

## Pooling (TREC / NIST, 1992–) — what `realtop` is

Real collections have millions of documents; you cannot have humans judge every document for every query. The standard solution is **pooling**:

1. Take the **top-k** results from **many systems**.
2. Form the **union** — the "pool."
3. Humans judge **only the pooled items.**
4. Everything not in the pool is **assumed non-relevant.**

**Our `realtop` set is exactly this:** for 20 anchor recipes, we pooled IDF's top-10 and the embedding's top-10, judged the union (DeepSeek, calibrated against a human spot-check), and scored each model on how well it ranked that pool. Pooling is not a shortcut we invented — it is how NIST has run TREC for 30+ years.

## Why pooling is considered valid

The justifying assumption: with **enough diverse systems** and **deep enough pools**, nearly every truly-relevant item is surfaced by *someone* and therefore judged. Zobel (1998), "How reliable are the results of large-scale IR experiments?", showed that although pools are incomplete, the **relative ranking of systems stays stable** — which is what you usually care about ("is A better than B?"). That is why pooling is best practice for **comparison**.

## Its known weakness — which is the pre-filtering concern

The field names this **pool incompleteness / pool bias**, and specifically the **reusability problem**:

- An item **no pooled system retrieved** is invisible (counted non-relevant) → the recall blind spot. Both systems could be missing a whole category of good results and the test would never show it.
- **Pool bias against novel systems:** a collection built from systems A/B/C can **unfairly penalize a later system D**, because D surfaces relevant items that were never judged, so they score as non-relevant.
- Mitigations: deeper/more-diverse pools; **incompleteness-robust metrics** like **bpref** (Buckley & Voorhees, 2004).

**This is exactly the "re-mine" caveat in our work:** our `realtop` pool was built from the *old* models (IDF + the SIF embedding). After the [SIF fix](../specs/embedding-recommender/spec.md), the embedding surfaces different recipes; some of its true top picks aren't in the pool and get no credit. **Concordance survives this** (it's pure pairwise ordering over judged items); **P@10 / nDCG are slightly optimistic** until the pool is re-mined from the changed model. That's textbook reusability bias.

## How production search engines actually do it

Google/Bing use pooling-style **offline** eval *and* something academia can't — **online evaluation on live users**, which dominates the ship decision:

- **Rater panels + guidelines.** Thousands of human quality raters work from published guidelines (Google's *Search Quality Rater Guidelines*, ~170 pages: needs-met scales, E-E-A-T). They judge the results systems actually return and do **side-by-side** comparisons of two rankings — pooling-adjacent (judge what's shown, not the whole web).
- **Interleaving** (Radlinski, Chapelle, Joachims). Mix results from ranking A and ranking B into one list; see which system's results users click. Extremely sensitive (needs far less traffic than A/B) and **sidesteps pooling** — real users implicitly judge whatever is shown.
- **A/B tests on live traffic** — the final arbiter. Measure real behavior: click-through, **long clicks / dwell time**, query reformulation, abandonment, session success. Users "judge" across everything shown, so the recall blind spot largely dissolves — a surfaced gem users love shows up in the behavior metrics.

**The relationship:** offline pooled eval is the **cheap, fast, pre-launch filter**; online (interleaving / A/B) is the **truth**. No serious engine ships a ranking change on offline numbers alone.

## The honest pipeline for shipping a recommender

1. **Offline pooled eval** (our Tier 1 + Tier 2) → decide *which* model to try.
2. **Re-mine + re-judge** from the chosen model's own output → remove pool bias against the changed model (the reusability fix).
3. **Online A/B or interleaving** on real users → the actual ship decision, measured by whether people cook/save the recommendations.

## Case study: why the tiered eval earned its keep (Sept 2026)

The recommender rebuild nearly went wrong twice, and the methodology caught both:

- **Tier 1 (metadata triplets) said "ship the embedding"** — it scored +9 points over IDF. But that was partly **circular**: the embedding folds cuisine/dish pseudo-tokens in, and Tier 1 triplets are *built from* cuisine/dish. Right call, wrong (untrustworthy) reason.
- **Tier 2 (human-calibrated `realtop`) said "no — it's at chance"**, even *below* random on good-vs-bad pairs. That contradicted Tier 1 and forced a real investigation.
- **An [ablation](./recommender-eval-glossary.md) localized the cause** to SIF pooling (toggling SIF × PC-removal with everything else fixed): SIF's `a/(a+p)` weighting gave a recipe's rarest ingredient ~150× weight, collapsing its vector onto one ingredient's co-occurrence pocket.
- **The fix (plain-mean pooling)** made the embedding genuinely beat IDF on human-aligned Tier 2 (concordance 0.72 vs 0.64) **and** reconciled the metrics — Tier 1↔Tier 2 Spearman went −0.5 → +1.0, so Tier 1 became a trustworthy daily proxy.

Without the human-labeled Tier 2, we'd have shipped a broken (SIF) model on a flattering metric — or, judging only the adversarial disagreement slice, killed a good model. **The tiers plus human calibration are what got to the truth.** The remaining honest step before shipping is a re-mined pool + an online test, per the pipeline above.
