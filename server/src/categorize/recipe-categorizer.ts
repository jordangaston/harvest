import type { Database } from '../db.js';
import type { RecipeCategories } from '../models/recipe.js';
import { FdcFoodRepository } from '../nutrition/fdc-food-repository.js';
import { FoodMatcher, type IngredientMatcher } from '../nutrition/food-matcher.js';
import { VOCAB, inVocab } from './vocab.js';
import { toPrimaryIngredient } from './fdc-category-map.js';
import { RuleTagger } from './rule-tagger.js';
import { selectCuisineClassifier, type CuisineClassifier } from './cuisine-classifier.js';

/** The minimal ingredient shape the categorizer reads (name only). */
export interface CategorizerIngredient {
  name: string;
}

/**
 * RecipeCategorizer (WI-TS-2) — derives a recipe's taste facets from its title +
 * ingredients, tiered cheapest-first: FDC seed (reuses the nutrition matcher) →
 * keyword rules → LLM (cuisine only). Merges with precedence and primary-ingredient
 * dominance (a title rule hit beats body/FDC), validates against VOCAB, dedups.
 * No writes — the caller (WI-TS-3) attaches the result and persists it.
 */
export class RecipeCategorizer {
  constructor(
    private readonly matcher: IngredientMatcher,
    private readonly rules: RuleTagger,
    private readonly classifier: CuisineClassifier,
  ) {}

  static create(db: Database): RecipeCategorizer {
    const matcher = FoodMatcher.create(FdcFoodRepository.create(db));
    return new RecipeCategorizer(matcher, new RuleTagger(), selectCuisineClassifier());
  }

  async categorize(title: string, ingredients: CategorizerIngredient[]): Promise<RecipeCategories> {
    const names = ingredients.map((i) => i.name);
    const hits = this.rules.tag(title, names);
    const fdcPrimary = await this.fdcPrimaryIngredients(names);

    const dishType = dedup(hits.dishType);
    const primaryIngredient = this.resolvePrimary(hits.primaryIngredient, fdcPrimary);
    const cuisine = await this.resolveCuisine(hits.cuisine, title, names);

    return {
      cuisine: valid('cuisine', cuisine),
      dishType: valid('dishType', dishType),
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

  /** Cuisine from rules if any; else escalate to the LLM. An LLM failure degrades to
   * empty cuisine (the other facets survive) rather than failing categorization. */
  private async resolveCuisine(ruleHits: string[], title: string, names: string[]): Promise<string[]> {
    if (ruleHits.length > 0) return dedup(ruleHits);
    try {
      return await this.classifier.classify(title, names, VOCAB.cuisine);
    } catch {
      return [];
    }
  }
}

function dedup(values: string[]): string[] {
  return [...new Set(values)];
}

/** Keeps only VOCAB members for the facet (defence — the LLM can emit anything). */
function valid(facet: 'cuisine' | 'dishType' | 'primaryIngredient', values: string[]): string[] {
  return values.filter((v) => inVocab(facet, v));
}
