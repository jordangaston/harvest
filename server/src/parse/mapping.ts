import type { ImportInput } from "../import-domain.js";
import type { RecipeInput } from "../repositories/recipe-repository.js";
import { parseIngredientLine, type StructuredIngredient } from "./ingredient.js";
import type { ExtractedRecipe } from "./website.js";
import type { ExtractedRecipeData } from "./extractor.js";

/**
 * The single chokepoint every source persists through — ports `toRecipeInput`
 * from server/src/pipeline/import-pipeline.ts. Strips bare section-labels, applies
 * the C4 servings estimate (default 4), sets the source url, and carries the C5
 * parsed nutrition through.
 */
export function toRecipeInput(data: ExtractedRecipeData, input: ImportInput): RecipeInput {
  const ingredients = stripIngredientSections(data.ingredients);
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
    steps: stripSectionLabels(data.steps),
    ...toNutritionInput(data),
    categories: data.categories,
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

/** Drop bare section headers from step text, but never empty a non-empty list. */
export function stripSectionLabels(list: string[]): string[] {
  const kept = list.filter((item) => !isSectionLabel(item));
  return kept.length ? kept : list;
}
