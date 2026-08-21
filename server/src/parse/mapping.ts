import type { ImportInput } from "../import-domain.js";
import type { RecipeInput } from "../repositories/recipe-repository.js";
import { parseIngredientLine, type StructuredIngredient } from "./ingredient.js";
import type { ExtractedRecipe } from "./website.js";
import type { ExtractedRecipeData } from "./extractor.js";
import type { RecipeDifficulty } from "../models/recipe.js";
import { DifficultyScorer } from "../difficulty/difficulty-scorer.js";
import type { Equipment } from "../schema.js";

// One shared, stateless scorer — the compiled technique regex is built once.
const difficultyScorer = DifficultyScorer.create();

/**
 * The single chokepoint every source persists through — ports `toRecipeInput`
 * from server/src/pipeline/import-pipeline.ts. Strips bare section-labels, applies
 * the C4 servings estimate (default 4), sets the source url, and carries the C5
 * parsed nutrition through.
 */
export function toRecipeInput(data: ExtractedRecipeData, input: ImportInput): RecipeInput {
  const ingredients = stripIngredientSections(data.ingredients);
  const { steps, stepTechniques, stepEquipment } = stripSteps(data.steps, data.stepTechniques, data.equipment?.stepEquipment);
  const parsed = data.servings ? parseInt(data.servings, 10) : NaN;
  const hasServings = Number.isFinite(parsed) && parsed > 0;
  return {
    title: data.title,
    sourceType: input.sourceType,
    sourceUrl: input.sourceType === "photo" ? undefined : input.sourceRef,
    servings: hasServings ? parsed : 4,
    servingsEstimated: !hasServings,
    totalMinutes: data.totalMinutes,
    imageUrl: data.imageUrl,
    confidence: data.confidence,
    ingredients,
    steps,
    ...toNutritionInput(data),
    allergens: data.allergens ?? null,
    categories: data.categories,
    diets: data.diets ?? null,
    difficulty: scoreDifficulty(steps, ingredients.length, data.totalMinutes, stepTechniques),
    cost: data.cost ?? null,
    mealPrepFit: data.mealPrepFit ?? null,
    // Re-align the per-step equipment to the FINAL (stripped) steps; the recipe-level set +
    // completeness are order-independent (WI-EQ-2).
    equipment: data.equipment ? { ...data.equipment, stepEquipment: stepEquipment ?? [] } : null,
  };
}

/** Scores difficulty (WI-DIFF-3, WI-DIFF-5) over the FINAL steps/ingredients — best-effort:
 * a scoring error leaves difficulty undefined rather than breaking the mapping, mirroring
 * the nutrition/allergen posture. `stepTechniques` (when present, aligned to the stripped
 * steps) drives the LLM detection path; else the keyword fallback scans the step text.
 * `stepDifficulties`/`stepTechniques` stay index-aligned to `steps`. */
function scoreDifficulty(
  steps: string[],
  ingredientCount: number,
  totalMinutes?: number,
  stepTechniques?: string[][],
): RecipeDifficulty | undefined {
  try {
    return difficultyScorer.score(steps, ingredientCount, totalMinutes ?? null, stepTechniques);
  } catch {
    return undefined;
  }
}

/** Strips bare section-label steps, carrying the per-step LLM arrays (`stepTechniques`,
 * `stepEquipment`) in lockstep so each stays aligned to the FINAL steps: zip, filter by the
 * same `isSectionLabel` predicate, unzip. Either array is absent when its LLM tier was off
 * (the keyword fallback scans the stripped step text). Never empties a non-empty step list
 * (mirrors `stripSectionLabels`). */
function stripSteps(
  steps: string[],
  stepTechniques?: string[][],
  stepEquipment?: Equipment[][],
): { steps: string[]; stepTechniques?: string[][]; stepEquipment?: Equipment[][] } {
  if (!stepTechniques && !stepEquipment) return { steps: stripSectionLabels(steps) };
  const zip = steps.map((step, i) => ({ step, techniques: stepTechniques?.[i] ?? [], equipment: stepEquipment?.[i] ?? [] }));
  const kept = zip.filter((p) => !isSectionLabel(p.step) && !isBareMarker(p.step));
  const rows = kept.length ? kept : zip;
  return {
    steps: rows.map((r) => r.step),
    ...(stepTechniques ? { stepTechniques: rows.map((r) => r.techniques) } : {}),
    ...(stepEquipment ? { stepEquipment: rows.map((r) => r.equipment) } : {}),
  };
}

/** Resolves the recipe's nutrition + NRF score to persist: the nutritionStep's estimate
 * when present (parsed macros kept, computed macros filled in), else the parsed label core. */
function toNutritionInput(data: ExtractedRecipeData): Pick<RecipeInput, "nutrition" | "nrfScore"> {
  const estimate = data.estimate;
  if (estimate) return { nutrition: estimate.nutrition ?? null, nrfScore: estimate.nrfScore };
  return { nutrition: data.nutrition ? { estimated: false, values: data.nutrition } : null };
}

/** Promote a JSON-LD `ExtractedRecipe` (raw string ingredients) to structured
 * `ExtractedRecipeData` — the single point `parseIngredientLine` runs for the
 * LLM-free website path. */
export function toExtractedData(structured: ExtractedRecipe, confidence: number): ExtractedRecipeData {
  const { ingredients, ...rest } = structured;
  return { ...rest, ingredients: ingredients.map(parseIngredientLine), confidence };
}

/** A usable recipe has at least a title and one ingredient. */
export function hasRecipe(data: { title: string; ingredients: unknown[] }): boolean {
  return Boolean(data.title) && data.ingredients.length > 0;
}

/** Drop bare ingredient section-headers; never empty a non-empty list. */
function stripIngredientSections(list: StructuredIngredient[]): StructuredIngredient[] {
  const kept = list.filter((item) => !isSectionLabel(item.quantityText || item.name));
  return kept.length ? kept : list;
}

/** A bare ingredient/step section header ("For the sauce", "To finish:"). Ported
 * verbatim from server/src/pipeline/import-pipeline.ts — conservative on purpose. */
export function isSectionLabel(text: string): boolean {
  const line = text.trim();
  const words = line.split(/\s+/);
  if (words.length > 6 || /\d/.test(line)) return false;
  return /^(for the\b|to (finish|serve|assemble|garnish|top|decorate|make|prepare)\b)/i.test(line) || /:$/.test(line);
}

/** A step that's just a list marker or punctuation ("1.", "2)", "—") — a JSON-LD
 * extraction artifact, never real instruction text. */
export function isBareMarker(text: string): boolean {
  return /^[\s\d.):–—-]+$/.test(text);
}

/** Drop bare section headers + stray list markers from step text, but never empty a
 * non-empty list. */
export function stripSectionLabels(list: string[]): string[] {
  const kept = list.filter((item) => !isSectionLabel(item) && !isBareMarker(item));
  return kept.length ? kept : list;
}
