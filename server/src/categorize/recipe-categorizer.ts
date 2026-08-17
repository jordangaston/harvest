import type { Database } from '../db.js';
import type { RecipeCategories } from '../models/recipe.js';
import { FdcFoodRepository } from '../nutrition/fdc-food-repository.js';
import { FoodMatcher, type IngredientMatcher } from '../nutrition/food-matcher.js';
import { inVocab } from './vocab.js';
import { toPrimaryIngredient } from './fdc-category-map.js';
import { RuleTagger } from './rule-tagger.js';
import { selectTasteClassifier, type TasteClassifier, type TasteFacets } from './taste-classifier.js';

/** The minimal ingredient shape the categorizer reads (name only). */
export interface CategorizerIngredient {
  name: string;
}

/**
 * RecipeCategorizer (WI-TS-2) — derives a recipe's taste facets from its title +
 * ingredients. cuisine + dish_type come from the LLM (`TasteClassifier`); primary_
 * ingredient stays FDC-grounded (the nutrition matcher) with title-keyword dominance
 * (a title hit beats body/FDC). Validates every value against VOCAB, dedups. No writes
 * — the caller (WI-TS-3) attaches the result and persists it.
 */
export class RecipeCategorizer {
  constructor(
    private readonly matcher: IngredientMatcher,
    private readonly rules: RuleTagger,
    private readonly classifier: TasteClassifier,
  ) {}

  static create(db: Database): RecipeCategorizer {
    const matcher = FoodMatcher.create(FdcFoodRepository.create(db));
    return new RecipeCategorizer(matcher, new RuleTagger(), selectTasteClassifier());
  }

  async categorize(title: string, ingredients: CategorizerIngredient[]): Promise<RecipeCategories> {
    const names = ingredients.map((i) => i.name);
    const primaryHits = this.rules.tag(title, names).primaryIngredient;
    const fdcPrimary = await this.fdcPrimaryIngredients(names);
    const primaryIngredient = this.resolvePrimary(primaryHits, fdcPrimary);
    const taste = await this.resolveTaste(title, names);

    return {
      cuisine: valid('cuisine', taste.cuisine),
      mealType: valid('mealType', taste.mealType),
      dishType: valid('dishType', taste.dishType),
      primaryIngredient: valid('primaryIngredient', primaryIngredient),
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

  /** cuisine + dish_type from the LLM. A failure degrades to empty for both (primary_
   * ingredient survives) rather than failing categorization. */
  private async resolveTaste(title: string, names: string[]): Promise<TasteFacets> {
    try {
      return await this.classifier.classify(title, names);
    } catch {
      return { cuisine: [], mealType: [], dishType: [] };
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
