import type { Database } from '../db.js';
import type { RecipeCategories } from '../models/recipe.js';
import { FdcFoodRepository } from '../nutrition/fdc-food-repository.js';
import { FoodMatcher, type IngredientMatcher } from '../nutrition/food-matcher.js';
import { inVocab } from './vocab.js';
import { toPrimaryIngredient } from './fdc-category-map.js';
import { RuleTagger } from './rule-tagger.js';
import { selectRecipeAnalyzer, type RecipeAnalyzer, type RecipeAnalysis } from './taste-classifier.js';

/** The minimal ingredient shape the categorizer reads (name only). */
export interface CategorizerIngredient {
  name: string;
}

/** The categorizer's output: the taste facets plus the per-step detected techniques
 * (WI-DIFF-5), aligned to the `steps` passed in (`[]` per step when the LLM is off). */
export interface RecipeAnalysisResult {
  categories: RecipeCategories;
  stepTechniques: string[][];
}

/**
 * RecipeCategorizer (WI-TS-2 + WI-DIFF-5) — derives a recipe's taste facets AND its
 * per-step techniques from its title, ingredients, and steps. cuisine + dish_type +
 * step techniques come from the ONE LLM call (`RecipeAnalyzer`); primary_ingredient
 * stays FDC-grounded (the nutrition matcher) with title-keyword dominance (a title hit
 * beats body/FDC). Validates every taste value against VOCAB, dedups. No writes — the
 * caller (WI-TS-3) attaches the result and persists it.
 */
export class RecipeCategorizer {
  constructor(
    private readonly matcher: IngredientMatcher,
    private readonly rules: RuleTagger,
    private readonly analyzer: RecipeAnalyzer,
  ) {}

  static create(db: Database): RecipeCategorizer {
    const matcher = FoodMatcher.create(FdcFoodRepository.create(db));
    return new RecipeCategorizer(matcher, new RuleTagger(), selectRecipeAnalyzer());
  }

  /**
   * Analyzes a recipe: taste facets + per-step techniques from the one LLM call.
   * @param title - The recipe title.
   * @param ingredients - The recipe's ingredients (names read).
   * @param steps - The recipe's ordered step texts; `stepTechniques[i]` aligns to `steps[i]`.
   * @returns The VOCAB-constrained facets and the `TECHNIQUE_NAMES`-constrained techniques
   *   per step. A LLM failure degrades taste to empty and techniques to `[]` per step
   *   (primary_ingredient survives), never throwing.
   */
  async analyze(title: string, ingredients: CategorizerIngredient[], steps: string[]): Promise<RecipeAnalysisResult> {
    const names = ingredients.map((i) => i.name);
    const primaryHits = this.rules.tag(title, names).primaryIngredient;
    const fdcPrimary = await this.fdcPrimaryIngredients(names);
    const primaryIngredient = this.resolvePrimary(primaryHits, fdcPrimary);
    const analysis = await this.resolveAnalysis(title, names, steps);

    return {
      categories: {
        cuisine: valid('cuisine', analysis.cuisine),
        mealType: valid('mealType', analysis.mealType),
        dishType: valid('dishType', analysis.dishType),
        primaryIngredient: valid('primaryIngredient', primaryIngredient),
      },
      stepTechniques: analysis.stepTechniques,
    };
  }

  /** Tier 1: match each ingredient to its FDC food group, map to a primary-ingredient
   * value, keep the usable (high/medium quality, non-null) ones. */
  private async fdcPrimaryIngredients(names: string[]): Promise<string[]> {
    const out: string[] = [];
    for (const name of names) {
      const match = await this.matcher.match(name);
      if (!match || match.quality === 'low') continue;
      const value = toPrimaryIngredient(match.category);
      if (value) out.push(value);
    }
    return dedup(out);
  }

  /** Dominance: a TITLE rule hit wins outright; otherwise the FDC-seeded candidates.
   * BODY-only rule hits never win alone — they are dropped here. */
  private resolvePrimary(hits: { value: string; location: 'title' | 'body' }[], fdc: string[]): string[] {
    const titleHits = dedup(hits.filter((h) => h.location === 'title').map((h) => h.value));
    return titleHits.length > 0 ? titleHits : fdc;
  }

  /** taste facets + step techniques from the one LLM call. A failure degrades to empty
   * facets + no techniques (primary_ingredient survives) rather than failing categorization. */
  private async resolveAnalysis(title: string, names: string[], steps: string[]): Promise<RecipeAnalysis> {
    try {
      return await this.analyzer.analyze(title, names, steps);
    } catch {
      return { cuisine: [], mealType: [], dishType: [], stepTechniques: [] };
    }
  }
}

function dedup(values: string[]): string[] {
  return [...new Set(values)];
}

/** Keeps only VOCAB members for the facet (defence — the LLM can emit anything). */
function valid(facet: 'cuisine' | 'mealType' | 'dishType' | 'primaryIngredient', values: string[]): string[] {
  return values.filter((v) => inVocab(facet, v));
}
