import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { codeCandidates, rank, type CatalogKind, type Candidate } from './catalog.js';
import { TasteOptionsService } from '../../services/taste-options-service.js';
import { BaseIngredientResolver } from '../../nutrition/base-ingredient-resolver.js';
import type { ChefTool, SaveResult, TurnContext } from './types.js';

const inputSchema = z.object({
  kind: z.enum(['taste', 'store', 'equipment', 'diet', 'allergen']),
  query: z.string().default(''),
});

/**
 * Grounds the model in the catalog before it commits a value: returns the candidates for a kind
 * ranked by match to the query (empty query → the full catalog), writing nothing. In the native
 * tool-loop the model sees these candidates and can pick a real id before calling a save tool.
 */
export class SearchCatalogTool implements ChefTool {
  readonly id = 'search_catalog';
  readonly saved: SaveResult[] = []; // grounding never writes
  private readonly taste: TasteOptionsService;
  private readonly ingredients: BaseIngredientResolver;

  private constructor(ctx: TurnContext) {
    this.taste = TasteOptionsService.create(ctx.db);
    this.ingredients = BaseIngredientResolver.create(ctx.db);
  }

  static create(ctx: TurnContext): SearchCatalogTool {
    return new SearchCatalogTool(ctx);
  }

  canRun(): boolean {
    return true;
  }

  asMastraTool() {
    return createTool({
      id: this.id,
      description:
        'Ground a value against the catalog before saving it. Returns candidate {value,label} entries ' +
        'for the kind (taste|store|equipment|diet|allergen) ranked by match to the query; empty query ' +
        'returns the full catalog. Writes nothing.',
      inputSchema,
      execute: async (input) => this.run(input),
    });
  }

  async run({ kind, query }: { kind: CatalogKind; query: string }): Promise<{ candidates: Candidate[] }> {
    return { candidates: await this.candidates(kind, query) };
  }

  private async candidates(kind: CatalogKind, query: string): Promise<Candidate[]> {
    if (kind !== 'taste') return rank(query, codeCandidates(kind));
    const opts = await this.taste.options();
    const ranked = rank(query, [...opts.cuisines, ...opts.dish_types, ...opts.ingredients]);
    if (!query.trim()) return ranked;
    // A modified/synonym ingredient ("grilled chicken", "salmon") won't label-match — resolve it
    // through the shared food matcher so grounding agrees with what save_member_profile will store.
    const base = await this.ingredients.resolve(query);
    return base && !ranked.some((c) => c.value === base.id) ? [{ value: base.id, label: base.label }, ...ranked] : ranked;
  }
}
