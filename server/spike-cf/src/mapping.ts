import type { ExtractedRecipe, ImportInput, StructuredIngredient } from './domain.js';

/** The recipe row shape persisted to D1 (ids/timestamps are added at insert). */
export interface RecipeRow {
  title: string;
  sourceType: ImportInput['sourceType'];
  sourceUrl: string | null;
  servings: number;
  servingsEstimated: boolean;
  totalMinutes: number | null;
  imageUrl: string | null;
  confidence: string | null;
  ingredients: StructuredIngredient[];
  steps: string[];
}

/**
 * The single chokepoint every source persists through — ports
 * `toRecipeInput` from server/src/pipeline/import-pipeline.ts. Strips bare
 * section-labels, applies the servings estimate (default 4), and normalises the
 * source url. (pg `numeric` confidence → text, matching the D1 schema.)
 */
export function toRecipeRow(data: ExtractedRecipe, input: ImportInput): RecipeRow {
  const ingredients = stripIngredientSections(data.ingredients);
  const parsed = data.servings ? parseInt(data.servings, 10) : NaN;
  const hasServings = Number.isFinite(parsed) && parsed > 0;
  return {
    title: data.title,
    sourceType: input.sourceType,
    sourceUrl: input.sourceType === 'photo' ? null : input.sourceRef,
    servings: hasServings ? parsed : 4,
    servingsEstimated: !hasServings,
    totalMinutes: data.totalMinutes ?? null,
    imageUrl: data.imageUrl ?? null,
    confidence: data.confidence != null ? String(data.confidence) : null,
    ingredients,
    steps: stripSectionLabels(data.steps),
  };
}

/** A usable recipe has at least a title and one ingredient. */
export function hasRecipe(data: ExtractedRecipe): boolean {
  return Boolean(data.title) && data.ingredients.length > 0;
}

/** Drop structured ingredients that are bare section headers; never empty a list. */
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
