import { FatalError } from "workflow";
import { eq } from "drizzle-orm";
import { dbFromEnv } from "../edge-db.js";
import { importJobs } from "../schema.js";
import { ImportJobRepository } from "../repositories/import-job-repository.js";
import { fetchSource, fetchLinkedRecipe, extract, type Material } from "../providers.js";
import { toExtractedData, hasRecipe } from "../parse/mapping.js";
import { persistAndReady } from "../import-persist.js";
import { importErrorCode, type ImportInput } from "../import-domain.js";
import { extractMedia, transcribe, readFrame, describePhoto, readSlideRecipe } from "./media-steps.js";
import type { ExtractedRecipeData } from "../parse/extractor.js";
import { NutritionEstimator } from "../nutrition/nutrition-estimator.js";
import { AllergenDetector } from "../allergen/allergen-detector.js";
import type { RecipeAllergens } from "../allergen/allergen.js";
import { RecipeCategorizer } from "../categorize/recipe-categorizer.js";
import { DietClassifier } from "../diet/diet-classifier.js";
import type { DietCompat } from "../diet/diet.js";
import { CostEstimator } from "../price/cost-estimator.js";

/**
 * The durable import workflow — the WDK port of DBOS's `ImportWorkflow` +
 * `ImportPipeline`. Shape: markRunning → fetchSource → resolveRecipes →
 * persistAndReady, with catch → markFailed. The workflow orchestrates only; every
 * unit of real work is a `"use step"` that returns serializable data. On a fault,
 * WDK replays and returns each completed step's logged result — resume-not-restart.
 * The workflow never throws; every outcome is a recorded job status.
 *
 * Media path (this story): a video source runs the per-frame FAN-OUT —
 * `extractMedia` (one ffmpeg step) then `Promise.all([transcribe(audio),
 * Promise.all(frames.map(readFrame))])`, each frame in its own invocation, all
 * concurrent. A carousel fans `readSlideRecipe` per slide — one recipe per slide.
 */
export async function importWorkflow(input: ImportInput): Promise<void> {
  "use workflow";
  try {
    await markRunning(input.jobId);
    const material = await fetchSourceStep(input);
    const recipes = await resolveRecipes(material, input);
    const enriched = await nutritionStep(recipes, input);
    const costed = await costStep(enriched, input);
    const profiled = await allergenStep(costed, input);
    const categorized = await categorizeStep(profiled, input);
    const dieted = await dietStep(categorized, input);
    await persistStep(dieted, input);
  } catch (err) {
    await markFailed(input.jobId, importErrorCode(err));
  }
}

/**
 * Resolve the fetched material to one or more structured recipes, orchestrating
 * the media fan-out in the workflow (so the per-frame steps run as separate,
 * concurrent invocations). Mirrors `ImportPipeline.run`'s tiering: structured
 * shortcut → caption-first → outbound link → media (ASR + per-frame OCR) → photo
 * → carousel. Returns recipes in slide order (usually one).
 */
async function resolveRecipes(material: Material, input: ImportInput): Promise<ExtractedRecipeData[]> {
  // Tier-0: a website/pin/rich structured recipe — no LLM.
  if (material.structured) {
    return [withThumbnail(toExtractedData(material.structured, 1), material.thumbnailUrl)];
  }

  // A multi-image carousel holds several recipes on its slides; OCR the slides
  // directly rather than caption-first (which would extract one thin teaser recipe).
  if ((material.imageUrls?.length ?? 0) > 1) return carouselRecipes(material.imageUrls!, material);

  // Caption-first: the free caption is often the whole recipe — try it before
  // spending ASR/vision on the media. A steps-less caption WITH media to fall back
  // on escalates; a caption recipe with no media to escalate to is accepted.
  if (material.caption) {
    const fromCaption = await extractStep({ caption: material.caption }, input);
    if (hasRecipe(fromCaption) && (fromCaption.steps.length > 0 || !hasMediaFallback(material))) {
      return [withThumbnail(fromCaption, material.thumbnailUrl)];
    }
  }

  // The caption pointed elsewhere — follow the linked recipe (best-effort).
  if (material.outboundLink) {
    const linked = await fetchLinkedRecipeStep(material.outboundLink);
    if (linked) return [withThumbnail(toExtractedData(linked, 1), material.thumbnailUrl)];
  }

  // Escalate to the media — the per-frame FAN-OUT.
  if (material.videoUrl) {
    const media = await extractMedia(material.videoUrl, material.videoHeaders);
    const [transcript, frameTexts] = await Promise.all([
      transcript_(media.audioBase64),
      Promise.all(media.frameBase64.map((frame) => readFrame(frame))),
    ]);
    const data = await extractStep(
      { caption: material.caption, transcript, visionText: frameTexts.join("\n") },
      input,
    );
    return [withThumbnail(requireRecipe(data), material.thumbnailUrl)];
  }

  // A single photo — one OCR read, then extract.
  if (material.imageRef) {
    const visionText = await describePhoto(await fetchImageBase64Step(material.imageRef));
    const data = await extractStep({ caption: material.caption, visionText }, input);
    return [withThumbnail(requireRecipe(data), material.thumbnailUrl)];
  }

  // A single-slide carousel (rare) still routes through the slide path.
  if (material.imageUrls?.length) return carouselRecipes(material.imageUrls, material);

  throw new FatalError("NO_RECIPE");
}

/** OCR each carousel slide (fanned out) and keep every recipe it yields, in slide
 * order. The thumbnail featured is the dish photo on the slide before the recipe. */
async function carouselRecipes(imageUrls: string[], material: Material): Promise<ExtractedRecipeData[]> {
  const perSlide = await Promise.all(imageUrls.map((url) => readSlideRecipe(url)));
  const recipes: ExtractedRecipeData[] = [];
  for (let i = 0; i < perSlide.length; i++) {
    const data = perSlide[i];
    if (!data) continue;
    const thumbnail = imageUrls[i - 1] ?? imageUrls[i];
    recipes.push({ ...data, imageUrl: data.imageUrl || thumbnail });
  }
  if (recipes.length === 0) throw new FatalError("NO_RECIPE");
  return recipes;
}

/** Transition the job to `running`. */
async function markRunning(jobId: string): Promise<void> {
  "use step";
  console.log(`[step] mark-running job=${jobId}`);
  await ImportJobRepository.create(dbFromEnv()).setRunning(jobId, 10);
}

/** Fetch the resolved source's material (website JSON-LD, social caption, or media refs). */
async function fetchSourceStep(input: ImportInput): Promise<Material> {
  "use step";
  console.log(`[step] fetch-source job=${input.jobId} type=${input.sourceType}`);
  return fetchSource(input);
}
fetchSourceStep.maxRetries = 3;

/**
 * The LLM extract step. A one-shot injected fault (proof-only) throws once so the
 * retry re-enters ONLY this step — upstream steps replay from the event log.
 */
async function extractStep(ctx: { caption?: string; transcript?: string; visionText?: string }, input: ImportInput): Promise<ExtractedRecipeData> {
  "use step";
  console.log(`[step] extract job=${input.jobId}`);
  if (input.faultStep === "extract" && (await bumpAndCheckFault(input.jobId))) {
    throw new Error("injected transient fault (extract) — expect a retry");
  }
  return extract(ctx);
}
extractStep.maxRetries = 3;

/** Follow a caption's outbound link to a JSON-LD recipe; null when it has none. */
async function fetchLinkedRecipeStep(url: string): Promise<Awaited<ReturnType<typeof fetchLinkedRecipe>> | null> {
  "use step";
  console.log(`[step] fetch-linked ${url}`);
  try {
    return await fetchLinkedRecipe(url);
  } catch {
    return null;
  }
}
fetchLinkedRecipeStep.maxRetries = 2;

/** Fetch a photo source (a URL or file ref) and return it as base64 for OCR. */
async function fetchImageBase64Step(imageRef: string): Promise<string> {
  "use step";
  if (/^https?:\/\//.test(imageRef)) {
    const res = await fetch(imageRef);
    if (!res.ok) throw new Error("MEDIA_UNAVAILABLE");
    return Buffer.from(await res.arrayBuffer()).toString("base64");
  }
  const { readFile } = await import("node:fs/promises");
  return (await readFile(imageRef)).toString("base64");
}

/** Alias so the workflow's Promise.all reads as `transcribe`/`readFrame` per DESIGN. */
const transcript_ = transcribe;

/**
 * Enrich every resolved recipe with computed nutrition + an NRF score before persist.
 * For each recipe: match its ingredients, convert to grams, aggregate the panel, and
 * score (`NutritionEstimator.run`). Estimates the eight macros only when the recipe has
 * no parsed nutrition; a parsed recipe keeps its macros but is still scored. Withholds
 * (no estimate, no score) when nothing matches or there are no servings. Reads the
 * seeded catalog from `dbFromEnv()` — no network. One info line per recipe (design Monitoring).
 */
async function nutritionStep(recipes: ExtractedRecipeData[], input: ImportInput): Promise<ExtractedRecipeData[]> {
  "use step";
  const estimator = NutritionEstimator.create(dbFromEnv());
  return Promise.all(recipes.map((recipe) => enrichOne(estimator, recipe, input)));
}
nutritionStep.maxRetries = 3;

/**
 * Enrich one recipe with its estimate, logging the outcome. Nutrition is best-effort
 * enrichment, so a scoring failure returns the recipe unenriched (it still persists with
 * its parsed nutrition, or none) rather than failing an import that would otherwise succeed.
 */
async function enrichOne(
  estimator: NutritionEstimator,
  recipe: ExtractedRecipeData,
  input: ImportInput,
): Promise<ExtractedRecipeData> {
  try {
    const estimate = await estimator.run(recipe.ingredients, resolvedServings(recipe), recipe.nutrition);
    console.log(
      `[step] nutrition job=${input.jobId} title=${recipe.title} ingredients=${recipe.ingredients.length} ` +
        `outcome=${outcomeLabel(estimate)} score=${estimate.nrfScore ?? "none"} matched=${countMatched(estimate)}`,
    );
    return { ...recipe, estimate };
  } catch (err) {
    console.log(`[step] nutrition job=${input.jobId} title=${recipe.title} outcome=error err=${String(err)}`);
    return recipe;
  }
}

/**
 * Attach a cost-per-serving estimate to every resolved recipe before persist. Reuses the
 * nutrition match+convert pass (`CostEstimator`) over the seeded price catalog from
 * `dbFromEnv()` — no network. Best-effort, exactly like `nutritionStep`: a per-recipe
 * try/catch means one estimate failure leaves that recipe's cost null (persists null
 * columns), never failing an import that would otherwise succeed. One info line per recipe.
 */
async function costStep(recipes: ExtractedRecipeData[], input: ImportInput): Promise<ExtractedRecipeData[]> {
  "use step";
  const estimator = CostEstimator.create(dbFromEnv());
  return Promise.all(recipes.map((recipe) => costOne(estimator, recipe, input)));
}
costStep.maxRetries = 3;

/**
 * Estimate one recipe's cost, logging the outcome (the design's monitoring hook:
 * `cost` and `coverage` per recipe). A failure returns the recipe uncosted (persists
 * null columns) rather than failing the import.
 */
async function costOne(
  estimator: CostEstimator,
  recipe: ExtractedRecipeData,
  input: ImportInput,
): Promise<ExtractedRecipeData> {
  try {
    const cost = await estimator.estimate(recipe.ingredients, resolvedServings(recipe));
    console.log(
      `[step] cost job=${input.jobId} title=${recipe.title} ` +
        `cost=${cost?.centsPerServing ?? "none"} coverage=${cost?.coverage.toFixed(2) ?? "none"} outcome=ok`,
    );
    return cost ? { ...recipe, cost } : recipe;
  } catch (err) {
    console.log(`[step] cost job=${input.jobId} title=${recipe.title} outcome=error err=${String(err)}`);
    return recipe;
  }
}

/**
 * Attach taste facets (cuisine/dish_type/primary_ingredient) to every resolved recipe
 * before persist. Best-effort enrichment, exactly like `nutritionStep`: a categorizer
 * failure returns the recipe uncategorized rather than failing an import that would
 * otherwise succeed. Reads the seeded FDC catalog from `dbFromEnv()` — no external
 * network unless the cuisine LLM tier is reached. One info line per recipe.
 */
async function categorizeStep(recipes: ExtractedRecipeData[], input: ImportInput): Promise<ExtractedRecipeData[]> {
  "use step";
  const categorizer = RecipeCategorizer.create(dbFromEnv());
  return Promise.all(recipes.map((recipe) => categorizeOne(categorizer, recipe, input)));
}
categorizeStep.maxRetries = 3;

/**
 * Categorize one recipe, logging the outcome. A failure returns the recipe
 * uncategorized (it persists with no facet rows) rather than failing the import.
 */
async function categorizeOne(
  categorizer: RecipeCategorizer,
  recipe: ExtractedRecipeData,
  input: ImportInput,
): Promise<ExtractedRecipeData> {
  try {
    const { categories, stepTechniques, mealPrepFit } = await categorizer.analyze(
      recipe.title,
      recipe.ingredients,
      recipe.steps,
      parsedServings(recipe),
    );
    console.log(
      `[step] categorize job=${input.jobId} title=${recipe.title} cuisine=${categories.cuisine.length} ` +
        `dish=${categories.dishType.length} primary=${categories.primaryIngredient.length} meal_prep=${mealPrepFit ?? 'none'} outcome=ok`,
    );
    return { ...recipe, categories, stepTechniques: stepTechniques.length ? stepTechniques : undefined, mealPrepFit };
  } catch (err) {
    console.log(`[step] categorize job=${input.jobId} title=${recipe.title} outcome=error err=${String(err)}`);
    return recipe;
  }
}

/** The servings the recipe persists with (mirrors `toRecipeInput`'s C4 default of 4). */
function resolvedServings(recipe: ExtractedRecipeData): number {
  const parsed = recipe.servings ? parseInt(recipe.servings, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 4;
}

/** The recipe's actual serving count, or null when absent/unparseable — the meal-prep
 * heuristic must not read the C4 default-4 as a real batch signal. */
function parsedServings(recipe: ExtractedRecipeData): number | null {
  const parsed = recipe.servings ? parseInt(recipe.servings, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** `estimated | parsed | withheld` — which branch the estimate took, for the log line. */
function outcomeLabel(estimate: { nutrition?: { estimated: boolean } }): string {
  if (!estimate.nutrition) return "withheld";
  return estimate.nutrition.estimated ? "estimated" : "parsed";
}

/** Whether any ingredient contributed (nutrition or a score means at least one matched). */
function countMatched(estimate: { nutrition?: unknown; nrfScore?: number }): string {
  return estimate.nutrition || estimate.nrfScore != null ? "some" : "none";
}

/**
 * Attach an allergen profile to every resolved recipe before persist, reusing the
 * nutrition match pass (`AllergenDetector`) over the seeded catalog from `dbFromEnv()`
 * — no network. Best-effort: a per-recipe try/catch means one detection failure
 * withholds only that recipe's profile (persists null → reads undetermined, never
 * "absent"), never failing an import that would otherwise succeed. One info line per
 * recipe (design Monitoring).
 */
async function allergenStep(recipes: ExtractedRecipeData[], input: ImportInput): Promise<ExtractedRecipeData[]> {
  "use step";
  const detector = AllergenDetector.create(dbFromEnv());
  return Promise.all(recipes.map((recipe) => enrichOneAllergen(detector, recipe, input)));
}
allergenStep.maxRetries = 3;

/**
 * Detect one recipe's allergens, logging the outcome. The log line is the monitoring
 * hook (no metrics framework): `outcome` feeds `allergen_detect_outcome{detected|withheld|error}`,
 * `complete` feeds `allergen_coverage_complete{true|false}`, and `recognized=n/total` is the
 * `allergen_annotation_gap` signal. A detection failure returns the recipe unprofiled (persists null).
 */
async function enrichOneAllergen(
  detector: AllergenDetector,
  recipe: ExtractedRecipeData,
  input: ImportInput,
): Promise<ExtractedRecipeData> {
  try {
    const allergens = await detector.detect(recipe.ingredients);
    console.log(
      `[step] allergen job=${input.jobId} title=${recipe.title} ` +
        `contains=${allergenList(allergens, "contains")} may=${allergenList(allergens, "may_contain")} ` +
        `complete=${allergens?.complete ?? "n/a"} recognized=${recognizedCount(recipe, allergens)}`,
    );
    return allergens ? { ...recipe, allergens } : recipe;
  } catch (err) {
    console.log(`[step] allergen job=${input.jobId} title=${recipe.title} outcome=error err=${String(err)}`);
    return recipe;
  }
}

/** The comma-joined allergens at a presence tier (`none` when empty/withheld) — for the log line. */
function allergenList(allergens: RecipeAllergens | null, presence: "contains" | "may_contain"): string {
  if (!allergens) return "withheld";
  const hits = Object.entries(allergens.presences).filter(([, p]) => p === presence).map(([a]) => a);
  return hits.length ? hits.join(",") : "none";
}

/** `n/total` recognized ingredients — the annotation-gap signal (complete=false ⇒ some unrecognized). */
function recognizedCount(recipe: ExtractedRecipeData, allergens: RecipeAllergens | null): string {
  const total = recipe.ingredients.length;
  if (!allergens) return `0/${total}`;
  return `${allergens.complete ? total : "<" + total}/${total}`;
}

/**
 * Attach a diet-compatibility signal to every resolved recipe before persist. ISOLATED
 * (DESIGN D-00): `DietClassifier` reads only the raw recipe and regenerates its own FDC
 * match + net-carb pass over the seeded catalog (`dbFromEnv()`) — no network, no dependency
 * on the nutrition/allergen/categorize steps. Best-effort: a per-recipe try/catch withholds
 * only that recipe's signal (persists no rows), never failing an import. One info line per recipe.
 */
async function dietStep(recipes: ExtractedRecipeData[], input: ImportInput): Promise<ExtractedRecipeData[]> {
  "use step";
  const classifier = DietClassifier.create(dbFromEnv());
  return Promise.all(recipes.map((recipe) => classifyOneDiet(classifier, recipe, input)));
}
dietStep.maxRetries = 3;

/**
 * Classify one recipe's diets, logging the outcome. The log line is the monitoring hook:
 * `complete` feeds `diet_coverage_complete{true|false}` and each `diet:verdict` feeds
 * `diet_fit{diet,verdict}`. A failure returns the recipe unsignalled (persists no rows).
 */
async function classifyOneDiet(
  classifier: DietClassifier,
  recipe: ExtractedRecipeData,
  input: ImportInput,
): Promise<ExtractedRecipeData> {
  try {
    const diets = await classifier.classify(recipe.ingredients, resolvedServings(recipe), recipe.nutrition);
    console.log(
      `[step] diet job=${input.jobId} title=${recipe.title} ` +
        `fit=${dietFitSummary(diets)} complete=${diets?.coverageComplete ?? "n/a"}`,
    );
    return diets ? { ...recipe, diets } : recipe;
  } catch (err) {
    console.log(`[step] diet job=${input.jobId} title=${recipe.title} outcome=error err=${String(err)}`);
    return recipe;
  }
}

/** The comma-joined `diet:verdict` pairs (`withheld` when null) — for the log line. */
function dietFitSummary(diets: DietCompat | null): string {
  if (!diets) return "withheld";
  return Object.entries(diets.fit).map(([id, v]) => `${id}:${v}`).join(",");
}

/** Persist each resolved recipe and drive the job to `ready`, linking them all. */
async function persistStep(recipes: ExtractedRecipeData[], input: ImportInput): Promise<void> {
  "use step";
  console.log(`[step] persist-and-ready job=${input.jobId} recipes=${recipes.length}`);
  const recipeIds = await persistAndReady(dbFromEnv(), recipes, input);
  console.log(`[step] persisted recipes=${recipeIds.join(",")} job=${input.jobId}`);
}
persistStep.maxRetries = 3;

/** Record the terminal failure. The workflow itself never throws. */
async function markFailed(jobId: string, code: string): Promise<void> {
  "use step";
  console.log(`[step] mark-failed job=${jobId} code=${code}`);
  await ImportJobRepository.create(dbFromEnv()).setTerminal(jobId, { status: "failed", progress: 100, errorCode: code });
}

/** Proof-only one-shot fault gate (persisted in `progress` so it survives a retry). */
async function bumpAndCheckFault(jobId: string): Promise<boolean> {
  const db = dbFromEnv();
  const [row] = await db.select({ progress: importJobs.progress }).from(importJobs).where(eq(importJobs.id, jobId));
  if ((row?.progress ?? 0) >= 11) return false;
  await ImportJobRepository.create(db).setRunning(jobId, 11);
  return true;
}

/** A usable recipe or a permanent NO_RECIPE. */
function requireRecipe(data: ExtractedRecipeData): ExtractedRecipeData {
  if (!hasRecipe(data)) throw new FatalError("NO_RECIPE");
  return data;
}

/** Whether the material has media to escalate to when a caption yields no steps. */
function hasMediaFallback(material: Material): boolean {
  return Boolean(material.videoUrl || material.imageRef || material.imageUrls?.length);
}

/** Feature the post's cover as the thumbnail when the parse found none. */
function withThumbnail(data: ExtractedRecipeData, thumbnailUrl?: string): ExtractedRecipeData {
  return data.imageUrl || !thumbnailUrl ? data : { ...data, imageUrl: thumbnailUrl };
}
