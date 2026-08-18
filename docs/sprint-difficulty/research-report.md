# How to Measure Recipe Difficulty: A Research Report

This report synthesizes adversarially-verified findings on recipe difficulty scoring, organized
by five angles. Claims are cited inline. Where a claim was checked and survived scrutiny, it's
stated plainly. Where a claim was refuted or overstated, that's flagged explicitly and it should
not be relied on.

---

## 1. Ingredient rarity/availability scoring

**What the evidence supports.** No academic paper or shipped product defines and validates a
standalone "ingredient rarity" or "availability" score. It's a real gap. Two independent
adversarial searches confirmed this directly: every place rarity-like signals show up, they're a
byproduct of a different task — substitution ranking, cuisine classification, or recommendation
similarity — never a first-class, validated construct with its own thresholds
([arXiv:2302.07960](https://arxiv.org/pdf/2302.07960), [ResearchGate
348762930](https://www.researchgate.net/publication/348762930_Identifying_Ingredient_Substitutions_Using_a_Knowledge_Graph_of_Food)).

What does exist is the raw material to build one. Ingredient occurrence counts across large
recipe corpora follow a long-tail distribution — a handful of pantry staples (salt, butter, eggs,
sugar, onion) dominate, and most distinct ingredients are rare. This is the statistical
precondition that makes an IDF-style rarity score meaningful. **Caution:** the specific claim that
this distribution is *linear on a log-log Zipf plot* was checked against two commonly-cited
sources (a Medium post and a GitHub hobby-project synopsis) and **refuted** — neither source
actually performs or shows a power-law fit. The phenomenon itself is real and *is* established in
peer-reviewed work (Kinouchi et al. 2008, [arXiv:0802.4393](https://arxiv.org/abs/0802.4393);
Escolar et al. 2024, [arXiv:2406.09445](https://arxiv.org/pdf/2406.09445)) — cite those, not the
blog/hobby sources, if this statistical grounding is load-bearing.

Multiple recipe-recommendation papers apply TF-IDF over ingredient lists (recipe = document,
ingredient = term), where the IDF term naturally up-weights ingredients appearing in fewer
recipes. This is a well-precedented, if informal, way to derive rarity — always in service of
similarity/recommendation, never as a standalone difficulty signal
([Chhipa et al. 2022, ITM Web of
Conferences](https://www.itm-conferences.org/articles/itmconf/pdf/2022/04/itmconf_icacc2022_02006.pdf);
[Mishra et al. 2025](https://theaspd.com/index.php/ijes/article/download/11236/8049/23671)).

**Concrete seedable data sources:**

| Dataset | Size | License | Notes |
|---|---|---|---|
| [Recipe1M+](https://arxiv.org/pdf/1810.06553) ([MIT CSAIL](http://im2recipe.csail.mit.edu/)) | 1M+ recipes, 13M+ images, scraped from 24+ sites | Registration-gated | Standard academic benchmark, ~200+ citations |
| [RecipeNLG](https://github.com/Glorf/recipenlg/blob/main/README.md) | 2,231,142 recipes; filter `source=Gathered` for ~1.6M higher-quality | Non-commercial/research | Built on Recipe1M+, cleaner structured fields |
| [3A2M](https://arxiv.org/html/2303.16778v1) | Reuses RecipeNLG's 2.23M, adds 9-category food-genre labels | CC BY-NC-SA 4.0 | Does not address rarity/difficulty at all |
| [Food.com / GeniusKitchen](https://www.kaggle.com/datasets/shuyangli94/food-com-recipes-and-user-interactions) ([paper](https://arxiv.org/pdf/1909.00105)) | 231,637 recipes, 1.13M interactions, 2000–2018, ~0.89 GB | Kaggle terms | Model in the paper actually trained on a filtered 180K/700K subset |
| [Kaggle "Recipe Ingredients" / Yummly "What's Cooking"](https://www.kaggle.com/datasets/kaggle/recipe-ingredients-dataset) | 39,774 recipes, 6,714 ingredients, 20 cuisines | Kaggle terms | Long-tailed by cuisine: Italian 7,838 vs. Brazilian/Russian ~400–489 |
| [Ahn et al. 2011 flavor-network dataset](https://zenodo.org/records/11449658) | 56,498 recipes, 381 ingredients, 5 world regions | **CC-BY-4.0** (commercially reusable) | **Caution:** commonly-cited "48,983 recipes / 8 regions" figure is **refuted** — that's from a 2024 derivative paper's deduplicated subset, not the original |
| [FlavorGraph](https://www.nature.com/articles/s41598-020-79422-8) | 6,653 ingredient nodes, 111,355 co-occurrence edges (NPMI-weighted), 1,561 flavor-compound nodes | Research use | Targets food-pairing embeddings, not rarity scoring |

**Strength of evidence:** High for the datasets' existence, size, and licensing (independently
verified against primary sources). Low-to-none for any validated rarity *metric* — because none
exists to verify. The IDF-as-rarity-proxy pattern is medium-strength: real and precedented, but
informal, never validated against a difficulty ground truth.

---

## 2. Technique/skill difficulty taxonomies & structural complexity metrics

**What the evidence supports.** This literature is small, fragmented, and — critically — every
weighting scheme found was **hand-designed and justified by illustrative examples, not fit
against human difficulty ratings.** Two adversarial verification passes confirmed no paper fits a
regression or reports feature-importance for step count vs. ingredient count vs. technique
diversity vs. graph depth against a validated human difficulty label
([ceur-ws.org/Vol-2028/paper26.pdf](https://ceur-ws.org/Vol-2028/paper26.pdf);
[colepeterson.me thesis](https://colepeterson.me/docs/Cole_T_Peterson_MSCS_Thesis.pdf)).

**Two concrete, reusable formulas:**

- **Müller & Bergmann (2017)** define `complexity(W) → [0,5]` as the *unweighted sum* of five
  [0,1]-normalized criteria: ingredient count, step count, ingredient-processing complexity
  (`1 − 2|steps|/|data-flow edges|`), average per-step technique complexity (a hand-annotated
  taxonomy value, e.g. "blanche" rated harder than "mix"), and normalized total duration. The
  score buckets into five bands: very easy `[0,1)`, easy `[1,2)`, medium `[2,3)`, difficult
  `[3,4)`, very difficult `[4,5]`
  ([ceur-ws.org/Vol-2028/paper26.pdf](https://ceur-ws.org/Vol-2028/paper26.pdf)). In their own
  evaluation (61 sandwich-recipe workflows, leave-one-out), weighting complexity equally against
  query fulfillment cut final complexity ~40% for only a ~5% drop in how well the recipe matched
  the user's request (0.92 → 0.87) — evidence the score is a real, separable, tunable knob, not
  just descriptive.

- **Peterson (2025, Ramapo College MSCS thesis)** models a recipe as a DAG (ingredients/equipment
  as operand nodes, actions as operator nodes, inspired by binary expression trees) and defines
  `C = 0.5·B + 0.35·A + 0.15·I`, where B = branch count (concurrent processes), A = unique action
  count ("depth"), I = unique ingredient count ("breadth"). Weights were chosen by stated author
  judgment, not fit — branch count is weighted highest because managing concurrent processes is
  judged to demand the most skill; ingredient count is weighted lowest because a 10-ingredient
  cake reduced to one "mix" action isn't actually complex
  ([colepeterson.me thesis](https://colepeterson.me/docs/Cole_T_Peterson_MSCS_Thesis.pdf)).
  Recipes are then bucketed Beginner (`C < P50`), Advanced (`P50 ≤ C < P85`), Expert (`C ≥ P85`)
  using dataset percentiles rather than fixed thresholds, so the cutoffs adapt to whatever corpus
  they're run against. On Peterson's own 76-recipe (mostly baking) dataset, C ranged 2.30–9.85
  (mean 4.58, SD 1.72), P85 = 5.93. Because 93% of recipes were single-branch, branch count barely
  moved the score in practice despite its 0.5 weight — **action count, not the highest-weighted
  factor, ended up as the actual differentiator** (Expert recipes needed 15+ actions vs. 5 for
  Beginner). This is a useful cautionary data point: a weight chosen for face-valid reasons can be
  swamped by a dataset's structural homogeneity.

**A separate entropy-based approach** (Kim et al. 2016) scores preparation complexity from
ingredient-frequency entropy and procedure complexity from cooking-verb entropy — rare
ingredients/verbs contribute more than common ones, independent of raw count. **Caution:** an
earlier characterization claiming this used *raw counts* directly was **refuted**; it's entropy
over frequency probabilities, `E(i) = -log P(i)`, summed per recipe. In their Korean recipe
dataset, the empirical extremes were concrete: "Braised Dongtae Seafood" (27 ingredients) was
hardest by ingredient entropy, "Boiled Potato" (potato, salt, sugar) easiest; "Jeolla-Province
Mosi-Songpyeon" (18 distinct verb types, 28 verb instances) was hardest by procedure entropy, a
single-verb "boil" soup was easiest
([Indian Journal of Science and Technology, 2016](https://indjst.org/articles/complexity-and-similarity-of-recipes-based-on-entropy-measurement)).

**NLP structural-parsing work** establishes that recipes can be reliably converted into
dependency-tree or DAG representations — but does not connect that structure to a difficulty
label. Jermsurawong & Habash's SIMMR (2015) parses recipes into ingredient-leaf/instruction-node
dependency trees at 93.5% edge accuracy on the 260-recipe CMU CURD corpus
([aclanthology.org/D15-1090.pdf](https://aclanthology.org/D15-1090.pdf)). Mori et al. (2014) built
the foundational Japanese "Flow Graph Corpus" (266 recipes, DAGs rooted at the final dish), which
Yamakata et al. (2020) extended to English (~300 recipes,
[aclanthology.org/2020.lrec-1.638](https://aclanthology.org/2020.lrec-1.638.pdf)). **Caution:**
calling Mori et al.'s DAG "the reference representation cited by nearly all later recipe-structure
papers" was checked and found **overstated** — it's an influential lineage-seed, not a universal
standard; Jermsurawong & Habash cite it only as related work while proposing their own tree
formalism.

**Historical honesty gap:** Buykx's PhD thesis notes that difficulty ratings in prior recipe
systems (Mennicken et al. 2010, Hamada et al. 2005) were assigned with no disclosed method at all
— "there is no objective measure of recipe difficulty"
([etheses.whiterose.ac.uk](https://etheses.whiterose.ac.uk/id/eprint/5158/1/Lucy%20Buykx%20accepted%20thesis.pdf)).
Buykx's own study found self-rated recipe difficulty correlates with skill/frequency for *some*
recipes but not others, and structural features weren't what was measured.

**Strength of evidence:** Medium-high for the two named formulas existing exactly as described
(both independently verified against primary-source PDFs, multiple times, word-for-word). Low for
any claim that these weightings are empirically optimal — they're principled heuristics, not
fitted models. No formula in this literature has been validated against a human-labeled ground
truth.

---

## 3. Time, equipment, and parallelism factors

**What the evidence supports.** The most rigorous academic model (Müller & Bergmann, above)
treats duration as one of five *additive* criteria, using a hand-annotated per-technique lookup
table (`taskComplexity(t) ∈ [0,1]`, `taskPreparationTime(t)` as an integer) built on the
WikiTaaable ontology — not computed dynamically or learned from text
([ceur-ws.org/Vol-2028/paper26.pdf](https://ceur-ws.org/Vol-2028/paper26.pdf)).

**The strongest production system found is Yummly's two patents**, which go further than any
academic source on time/parallelism extraction:

- **US Patent 9,797,873** ("Prediction of recipe preparation time") predicts total prep time via
  multiple linear regression over knowledge-graph-matched equipment/technique/ingredient mentions,
  regex-style detection of explicit time phrases (`<number> <unit>`, e.g. "boil for five
  minutes"), and ingredient-quantity scaling (mashing 12 potatoes takes longer than mashing one).
  Coefficients are non-negativity-constrained and L1-regularized for feature selection
  ([patents.google.com/patent/US9797873](https://patents.google.com/patent/US9797873)).
  **Its most useful documented technique:** discourse-cue detection for parallelism — "while,"
  "meanwhile," "in another [equipment]" signal concurrent steps, and the model *omits* the shorter
  parallel step's duration from the total rather than summing both; "or"/"alternatively" signal
  alternatives and trigger an averaged/ranged estimate instead. This is the clearest documented
  method anywhere in this research for extracting parallel structure from free recipe text. It
  does **not** model active vs. passive time separately — everything is summed into one total,
  then a flat 5–30% buffer is added for an average (non-expert) cook, optionally tuned by inferred
  user skill.

- **US Patent 9,489,377** ("Inferring recipe difficulty") extracts equipment/ingredient mentions
  via a knowledge graph (e.g. "potato ricer," "contact grill"), ingredient+technique combination
  features (egg + poaching scored harder than egg + boiling), ancestor/abstraction features (an
  uncommon ingredient like "weisswurst" generalizes to "sausage"), quantity/serving-size anomalies
  (20 lbs of pasta implies an industrial kitchen), descriptive-text sentiment cues ("rare" vs.
  "well done"), and corpus-wide term popularity. It's the only source in this research that
  operationalizes equipment as a difficulty signal at the ingredient+technique-combination level,
  not just presence/absence. Each attribute (easy/medium/hard, or specialized tags like "obscure
  ingredients," "specialized cooking equipment," "industrial kitchen") is scored via a separate
  logistic regression: features × trained coefficients, summed, sigmoid, thresholded. **No
  numeric threshold value is disclosed in the patent**
  ([patents.google.com/patent/US9489377](https://patents.google.com/patent/US9489377)).

**Active-vs-passive time as a labeling convention** is well established editorially — America's
Test Kitchen publishes both "active time" and "start-to-finish time" — but **caution:** this was
checked and only confirmed for *specific* ATK titles (e.g. *The Ultimate Meal-Prep Cookbook*), not
as a universal house-wide practice across every ATK/Cook's Illustrated publication as originally
claimed. It was **not found formalized as a feature in any academic difficulty model reviewed**;
the automated-extraction research (Yummly's patents included) collapses prep+cook+rest into one
total-time feature.

**A separate, harder-to-place finding:** an entropy/behavioral study (Miyoshi et al. 2015, using
Japan's Cookpad platform, 463,921 users / 805,018 recipes / 9.4M comment links) tried inferring
difficulty *purely from user-engagement network structure* (no content features at all,
PageRank/HITS-style) and validated against 30 recipes rated by 7 women aged 20–80. The result was
a **negative** Spearman correlation (ρ = −0.358 and −0.543 for two variants) — the network-only
approach ranked easier recipes as harder, because platform users disproportionately engaged with
*easy* recipes
([AACE eLearn 2015](https://s3.amazonaws.com/aace-conf-media/conf/elearn/submission/uploads/elearn2015/paper_46393.pdf)).
This is a genuine cautionary result: pure popularity/engagement signals, absent any content
features (time, equipment, steps), can actively point the wrong direction.

**Strength of evidence:** High for both Yummly patents' mechanisms (multiple independent verbatim
checks against the actual patent text). Medium for the "no validated ranking of which factor
matters most" conclusion — every source treats difficulty as inherently multi-dimensional and
additive rather than establishing one dominant factor. High for the Cookpad negative-correlation
result as a standalone cautionary data point, though its "cautionary result" framing is somewhat
stronger than the original authors' own conclusion (they called the correlation "decent" and
proposed just inverting the algorithm's output).

---

## 4. Validated/deployed models & ground-truth labels

**What the evidence supports.** This is the weakest-evidenced angle, and it matters most for a
"can I trust this" judgment. **No widely-cited, rigorously validated model was found that predicts
recipe difficulty from recipe features and reports strong accuracy against human-labeled ground
truth.**

Everywhere difficulty appears in ML pipelines, it's an *input feature* for a different prediction
target (popularity, rating), not a validated *target* itself:

- **Trattner, Moesslang & Elsweiler (2018, EPJ Data Science)** scraped Allrecipes.com and
  Kochbar.de and built popularity predictors reaching up to 60.23% accuracy (Allrecipes) and
  88.45% (Kochbar.de). **Caution:** an earlier characterization claiming these papers used
  "difficulty level and price level" as input features across both platforms was checked and
  **refuted** — those fields are mentioned once, describing Kochbar.de's upload UI only, and
  neither field appears anywhere in the actual feature sets used (which instead use prep time,
  step count, ingredient count as a "Recipe Complexity" proxy).
- **Akbari (2023, University of Oulu MSc thesis)** scraped 5,472 Valio.fi recipes with a
  site-assigned 3-level Difficulty field (1=simplest, 3=most complex), used as one input alongside
  prep time and ingredient count for predicting a popularity-derived rating group. Adding this
  difficulty-adjacent feature set gave only a slight precision bump over nutrition features alone;
  the largest accuracy gain came from adding user-engagement features (comments, ratings), and the
  best model (Logistic Regression / Random Forest, tied) reached 0.93 accuracy / 0.90 F1 — **for
  popularity, not difficulty**
  ([oulurepo.oulu.fi thesis](https://oulurepo.oulu.fi/bitstream/handle/10024/43040/nbnfioulu-202310133120.pdf?sequence=1)).

**Caution — a specific paper misattribution to flag:** claims that Lăpuşan et al. (2022, IEEE)
trained logistic regression vs. decision trees on nouns/ingredients to predict a difficulty-like
label at ~45–46% F1 were checked and **refuted**. That specific result (nouns-only 45% F1,
ingredients-only 43–46% F1, logistic regression beating decision trees) belongs to a *different*
paper — Kicherer et al. (NLDB 2017), on 263,854 Chefkoch.de recipes, predicting recipe *category*
(87 classes), not difficulty. The best combination there was ingredients+nouns at 48% F1 (5K
training recipes), rising to 57% F1 at 50K. A tested prep-time feature in that same study provided
essentially no signal for category prediction (F1 5%) — but that's a category task, not a
difficulty task, so it shouldn't be read as evidence time doesn't matter for difficulty
specifically.

**Consumer sites use simple, editorially-assigned ordinal labels, not ML.** BBC Good Food tags
every recipe Easy / More effort / A challenge, verified live on-site alongside cook time and
rating (e.g., "Chicken pasta bake, 1 hr 15 mins, Easy"); the site publicly describes recipes as
"triple-tested" by a human recipe development team, with no evidence anywhere of algorithmic
scoring
([bbcgoodfood.com](https://www.bbcgoodfood.com/recipes/collection/easy-dinner-recipes)). The
Recipe Critic publishes an explicit, human-authored three-tier rubric combining ingredient count,
technique, and active time: Easy (≤8–10 ingredients, basic techniques, ≤30 min active),
Intermediate (10–15 ingredients, multi-step techniques, 45–90 min), Advanced (15+ ingredients,
advanced methods like roux/laminated dough/tempering, 2+ hours)
([therecipecritic.com/recipe-skill-levels](https://therecipecritic.com/recipe-skill-levels/)).
**No validation study of either labeling scheme against objective recipe features was found
anywhere.**

**Ground-truth datasets that do exist are small, unvalidated, or heuristic-labeled**, not
human-validated ML targets: two small Kaggle sets (64K and 500 recipes) carry a Difficulty column,
but the larger one's own documentation admits the labels were "generated using rule-based and
NLP-assisted feature extraction methods" — i.e., synthetic, not human-annotated ground truth.

**Strength of evidence:** Low across the board — this is the genuine, confirmed gap in the
literature. Multiple independent verification passes on different candidate counter-examples
(patents, IEEE papers, Kaggle sets) consistently found either no validation against human ground
truth, or difficulty used only as an input feature for a different target.

---

## Refuted claims — do not rely on these

For completeness, these specific claims were checked during this research and **failed
verification**. They're listed so they don't get reintroduced by mistake:

- Recipe1M has ~16,000 raw ingredient strings canonicalizing to ~1,400 covering 95% of
  occurrences — the real figure is **~4,000** ingredients for 95% coverage, not ~1,400.
- RecipeNLG's terms of use were verified against the paper/homepage — the actual license text
  lives on the gated dataset-download page, not either cited source; use that page directly if the
  license matters.
- The Ahn et al. 2011 flavor-network dataset is "48,983 recipes... 8 world regions" — the
  original is **56,498 recipes, 5 regions**; 48,983/8-regions is a *later derivative paper's*
  reprocessed subset, not the original.
- Ingredient frequency in recipe corpora is "linear on a log-log Zipf plot" (as cited to a Medium
  post and a GitHub hobby project) — neither source actually performs this analysis. The
  underlying phenomenon is real but should be cited to Kinouchi et al. 2008 or Escolar et al.
  2024 instead.
- Recipe1MSubs/GISMo "builds" its ingredient-relation graph from co-occurrence — it actually
  *reuses* the pre-existing FlavorGraph rather than constructing it, and FlavorGraph is a
  hybrid co-occurrence + food-chemistry graph, not pure co-occurrence.
- Müller & Bergmann's five-criteria complexity score is "weighted" — it's an **unweighted sum**;
  the only weighting parameter in that paper (α) blends the *overall* complexity score against
  query fulfillment in a separate downstream formula, not the five sub-criteria.
- Kim et al.'s entropy measure uses "raw ingredient/verb count" — it actually uses summed
  self-information (`-log P(i)`) over corpus frequency, so rarity, not count, drives the score.
  A recipe with fewer raw ingredients can score more complex if they're rarer.
- Mori et al.'s 2014 DAG format is "the reference representation cited by nearly all later
  recipe-structure papers" — overstated; it seeded one influential lineage but competing tree
  formalisms (e.g., SIMMR) exist and don't adopt it.
- Yummly's difficulty patent (US 9,489,377) was filed "September 2014, granted May 2017" — actual
  dates are filed July 21, 2014, granted November 8, 2016. The extracted-feature mechanisms
  themselves are accurate; only the dates were wrong.
- Trattner et al. (2018) used a "difficulty level and price level" field from both Allrecipes.com
  and Kochbar.de as input features — that field is mentioned once, describing only Kochbar.de's
  upload UI, and isn't used as a feature by either platform's model.
- Lăpuşan et al. (2022, IEEE) reported nouns-only 45% F1 / ingredients-only 46% F1 with logistic
  regression beating decision trees — this result belongs to a different paper (Kicherer et al.
  2017, on recipe *category* classification, not difficulty or cooking parameters). Lăpuşan et
  al.'s actual finding is that pretrained language models on text alone perform best.
- "No major public recipe dataset has a validated, human-annotated difficulty label used as a
  benchmark target" — overstated as an absolute; the DEFT2013 shared task (~16–23K French
  recipes from Marmiton.org, 4-level self-reported difficulty) has been reused as a benchmark
  target across multiple papers 2013–2020, though its labels are author-self-reported with only
  ~37–52% independent-annotator agreement, not gold-standard.
- "No paper reports inter-rater agreement for difficulty labels, and no paper compares
  feature-based vs. LLM-based difficulty classification on shared ground truth" — overstated;
  kappa-reporting is a live norm in adjacent recipe-annotation literature (0.5–0.88 range across
  several corpora), and the DEFT2013/LREC2020 lineage already runs exactly this kind of
  feature-baseline-vs-neural-model shared-test-set comparison, just pre-dating the LLM era.

---

## What this implies for a simple, buildable difficulty score

Given the evidence above, the buildable path is an **unweighted or lightly-weighted additive
score over cheap, extractable features** — not a learned model, because no validated ground truth
exists to train one against, and not a single silver-bullet feature, because every credible source
treats difficulty as inherently multi-dimensional.

1. **Start with Müller & Bergmann's five-factor shape** (ingredient count, step count, an
   ingredient-processing ratio, per-technique complexity from a small hand-built taxonomy, total
   duration) — it's the only formula in this research validated even indirectly (via a real
   retrieval trade-off experiment), and every term is cheap to extract from structured recipe
   data you likely already store.
2. **Use a hand-built technique taxonomy, not NLP inference, for step complexity.** Both credible
   production systems (Müller & Bergmann's WikiTaaable taxonomy; Yummly's patents) rely on a
   small manually-annotated lookup table (technique → complexity score), not a learned model. This
   is the single highest-leverage, lowest-effort piece: a few dozen techniques (blanch, poach,
   temper, laminate vs. stir, boil, mix) covers most recipes.
3. **Don't try to build a rarity/availability score from scratch — there's no precedent to
   copy.** If ingredient availability matters to the product, the cheapest defensible version is
   IDF over a seed corpus (the Ahn et al. 2011 CC-BY-4.0 dataset is small, clean, and
   commercially reusable for this) with a hand-curated pantry-staple exclusion list, treated as a
   separate, clearly-labeled signal — not folded silently into "difficulty."
4. **Percentile-bucket the raw score, don't hardcode difficulty-band cutoffs.** Peterson's
   P50/P85 approach adapts to whatever recipe corpus you actually have, rather than baking in
   thresholds tuned to someone else's dataset.
5. **If parallelism matters, borrow Yummly's discourse-cue trick** ("meanwhile," "while," "in
   another pan" → omit the shorter step's time) rather than attempting full DAG/graph parsing —
   it's a regex-level win with outsized payoff relative to the structural-parsing literature's
   complexity.
6. **Validate honestly, at small scale, before trusting the score.** Because no source in this
   research validated any recipe-difficulty formula against human ground truth, plan for a small
   internal calibration pass (even 20–30 recipes rated by a handful of people, as Buykx did) rather
   than assuming any published weighting is correct out of the box. Treat published weights as
   defensible starting points, not settled science.
7. **Treat user engagement/popularity as untrustworthy for inferring difficulty.** The one study
   that tried deriving difficulty purely from user behavior got the direction backwards — easy
   recipes get more engagement, not harder ones. Don't use "recipe is popular" as a proxy for
   "recipe is easy" or vice versa without a content-based signal underneath it.