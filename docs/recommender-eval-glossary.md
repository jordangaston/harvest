# Recommendations & Evaluation — Glossary

*Terms of art used across the recommender work — the [eval harness](../knowledge/harvest/proposals/recommender-eval-harness.md), the [embedding model](../knowledge/harvest/proposals/embedding-recipe-similarity.md), and the [course/form split](../knowledge/harvest/specs/split-course-facet/spec.md). Each entry: what it means, how **we** use it, and what it's normally for. Read this before reviewing those docs.*

## Evaluation shape

### Offline evaluation
Measuring model quality from fixed data, with no live users in the loop. **In Harvest:** we're pre-launch with zero behavioral data, so every metric here is offline — computed against checked-in label files, not production traffic. **Typically:** the fast, repeatable half of ML evaluation; the counterpart is *online* evaluation (A/B tests, live metrics).

### Weak supervision (a.k.a. distant supervision)
Generating training/eval labels automatically from signals you already have — metadata, heuristics, logs — instead of paying humans to label. The labels are individually noisy but free and plentiful. **In Harvest:** Tier 1 triplets are minted from recipe `cuisine` + `dish_type` metadata — no annotator, millions of examples. **Typically:** how you bootstrap a model or an eval set when you have no hand labels yet (the Snorkel / programmatic-labeling lineage).

### Gold set (ground truth)
A small, trusted, human-verified label set treated as the source of truth. **In Harvest:** the ~200–300 human-corrected pairwise judgments in Tier 2. **Typically:** the yardstick a cheap proxy metric is validated against; small because human labels are expensive.

### Proxy metric
A cheap, fast metric used as a stand-in for an expensive one, valid only while it *tracks* the expensive one. **In Harvest:** Tier 1 triplet accuracy is the proxy for the Tier 2 gold set. **Typically:** what lets you iterate quickly — but it must be periodically re-validated against ground truth or it silently drifts into lying.

### Baseline
A deliberately trivial model scored alongside the real ones to give the metric a floor. **In Harvest:** a *random* recommender and a *popularity* recommender; a trustworthy metric must show `random < popularity < IDF < embeddings`. **Typically:** the sanity check that catches a broken metric or a model that isn't actually learning — if the real model barely beats random, something is wrong.

### Known-answer probe
A handful of hand-picked cases with an obvious correct answer, asserted like a unit test. **In Harvest:** ~20 cases such as "carbonara → pasta/Italian neighbors, never a smoothie." **Typically:** the smallest thing that fails loudly on a regression; cheap insurance next to aggregate metrics.

### Tiered evaluation (Tier 1 / 2 / 3)
Harvest's own framing: **Tier 1** = free metadata weak-labels (daily driver), **Tier 2** = small human gold set (truth), **Tier 3** = behavioral signal (real truth, post-launch). Cheap-and-noisy at the bottom, expensive-and-trustworthy at the top; each tier validates the one below it.

## Labeling techniques

### Triplet (anchor / positive / negative)
Three items where the *positive* should be more similar to the *anchor* than the *negative* is. **In Harvest:** anchor recipe, a positive sharing cuisine + dish form, a negative sharing neither. **Typically:** the standard unit of **metric learning** / contrastive evaluation — you score a model by how often it orders the triplet correctly.

### Pairwise preference elicitation
Asking a human a *relative* question ("is A or B more similar to the anchor?") rather than an absolute rating ("rate A's similarity 1–10"). **In Harvest:** the form of every Tier 2 question. **Typically:** a psychometrics / learning-to-rank staple — people are far more consistent at relative comparisons than at absolute scores.

### Active learning (query-by-committee / disagreement sampling)
Spending your scarce labeling budget on the examples that carry the most information — here, the pairs where two models most *disagree*. **In Harvest:** Tier 2 labels only the max-disagreement pairs between IDF and embeddings; agreement cases teach nothing. **Typically:** how you get the most out of a small labeling budget; "query-by-committee" is the variant that samples where an ensemble of models diverges.

## Metrics

### Triplet accuracy
The fraction of triplets a model orders correctly — `similarity(anchor, positive) > similarity(anchor, negative)`. **In Harvest:** the Tier 1 and Tier 2 headline number, a single interpretable scalar that drives daily iteration. **Typically:** the go-to scalar for contrastive/embedding evaluation.

### Precision@k
Of the top *k* results shown, the fraction that are actually relevant. **In Harvest:** Precision@10, because the swipe deck shows 10 cards (`DECK_DEFAULT_LIMIT`). **Typically:** the simplest top-k retrieval metric; its blind spot is *order* — it doesn't care whether the best result is first or tenth.

### nDCG@k (normalized discounted cumulative gain)
A rank-weighted relevance score over the top *k*: each result earns a graded relevance (**gain**), divided by a position **discount** (`log₂(rank+1)`) so lower slots count less; the sum (**DCG**) is **normalized** by the ideal ordering's DCG (**IDCG**) to land in 0–1. **In Harvest:** nDCG@10 on the Tier 2 set, for graded final judgment. **Typically:** the standard ranking metric when *order* matters — 1.0 = perfect ordering, ~0.5 = relevant items in a mediocre order.

### Spearman rank correlation (ρ)
How well two rankings agree, from −1 (opposite) to +1 (identical). **In Harvest:** score every model on both Tier 1 and Tier 2, then take ρ between the two score vectors across models — high ρ means the cheap proxy orders models the same way the gold set does, so it's safe to iterate on. **Typically:** the standard way to check whether a proxy metric is a valid stand-in for a trusted one.

## Similarity & retrieval

### Recommender (`rank(recipeId) -> RecipeId[]`)
Here, a recipe-to-recipe *similarity* function: given one recipe, return the most similar others. **In Harvest:** the interface both the IDF engine and the embedding model implement, so the harness scores them through one pipe. Distinct from the personalized swipe *ranker* (`RankingEngine.rank(recipes, prefs)`), which orders by user preference.

### Cosine similarity
The cosine of the angle between two vectors — 1 = identical direction, 0 = unrelated. **In Harvest:** how recipe taste profiles are compared (`server/src/ranking/taste/taste-profile.ts`). **Typically:** the default similarity measure for embeddings and sparse text vectors, because it ignores magnitude and compares direction.

### Embedding (vector)
A fixed-length list of numbers representing an item so that similar items sit close together. **In Harvest:** the [embedding proposal](../knowledge/harvest/proposals/embedding-recipe-similarity.md) learns ingredient vectors and pools them into a recipe vector. **Typically:** the representation underneath most modern similarity, search, and recommendation.

### Nearest-neighbor search (brute-force vs. ANN)
Finding the closest vectors to a query. **Brute-force** compares against every item (one matrix multiply); **ANN** (approximate nearest neighbor, e.g. FAISS) trades exactness for speed at large scale. **In Harvest:** brute-force cosine is fine at our corpus size; we skip ANN until the corpus is genuinely large. **Typically:** brute-force below ~100k items, ANN above.

### IDF (inverse document frequency) & document frequency
**Document frequency** = how many recipes contain an ingredient; **IDF** = `ln(N / (1 + df))`, so rarer ingredients weigh more. **In Harvest:** the current similarity engine weights ingredients by IDF; precomputed per base ingredient in the `ingredientDistinctiveness` table. **Typically:** a classic information-retrieval weighting — and the source of the bug this whole effort targets (one rare ingredient dominating a recommendation).

### PMI (pointwise mutual information)
How much more two things co-occur than chance would predict: `log( P(a,b) / (P(a)·P(b)) )`. **In Harvest:** the embedding proposal builds ingredient vectors from ingredient-pair PMI — the co-occurrence signal IDF throws away. **Typically:** a co-occurrence measure underlying word/item embeddings.

### SVD (singular value decomposition)
A matrix factorization that compresses a large matrix into a few dimensions capturing most of its structure. **In Harvest:** factors the ingredient PMI matrix down to ~100-dim ingredient embeddings. **Typically:** the deterministic, dependency-light way to turn a co-occurrence matrix into embeddings (provably close to word2vec).

### SIF pooling (smooth inverse frequency)
Combining a set of item vectors into one, weighting each by `a/(a+freq)` and subtracting the shared "background" component, so distinctive items steer the result. **In Harvest:** pools ingredient vectors into a recipe vector without letting salt/water/oil blur everything together. **Typically:** a strong, cheap alternative to a plain average when pooling token vectors.

### Pseudo-token
A non-word tag injected into the vector-building process so it earns its own learned vector. **In Harvest:** `CUISINE:thai` / `BASE:curry_paste` appended to a recipe's ingredients so cuisine pulls similar recipes together. **Typically:** a trick to fold categorical metadata into an embedding model with no new machinery.

### Corpus
The full set of items under consideration. **In Harvest:** all recipes with at least one base ingredient; the count is dynamic, not a constant. **Typically:** the population an IR/ML system indexes and evaluates over.

## Recipe metadata (facets)

### Facet
A single controlled-vocabulary axis of recipe metadata, stored one value per row in `recipeCategories` (`server/src/categorize/vocab.ts`). The facets below are meant to be **orthogonal** — each answers one question.

### cuisine
The culinary tradition (italian, thai, mexican …), from the authored `cuisines` hierarchy. A **similarity axis** in the triplets.

### meal_type
*When* a dish is eaten: breakfast, brunch, lunch, dinner, snack. Orthogonal to form — french toast is a `breakfast` (meal_type) that is a `pancake`/`bread` (dish form).

### course
*Role in a meal*: appetizer, main_course, side_dish, dessert. **In Harvest:** being split out of `dish_type` (see the [split spec](../knowledge/harvest/specs/split-course-facet/spec.md)); used as a retrieval *filter* (don't pair a dessert with a main), not as a similarity axis.

### dish_type (dish form)
*What the dish physically is*: pasta, pizza, soup, salad, curry, stir_fry … (forms only, once `course` is split off). **In Harvest:** with `cuisine`, this is the "same kind of dish" signal that defines a triplet positive.

### primary_ingredient
The protein/base category: seafood, poultry, beef, tofu, beans, grain … **In Harvest:** deliberately *not* used in the eval triplets — requiring the protein to match over-constrains "similar," and the embedding model learns protein straight from ingredients.
