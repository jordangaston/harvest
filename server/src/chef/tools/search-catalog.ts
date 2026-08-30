import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { codeCandidates, rank, type CatalogKind, type Candidate } from './catalog.js';
import type { ChefState, ToolCtx } from './types.js';

const inputSchema = z.object({
  kind: z.enum(['taste', 'store', 'equipment', 'diet', 'allergen']),
  query: z.string().default(''),
});

/** Pure precondition: grounding never writes, so it always runs. */
export function canRun(_state: ChefState): boolean {
  return true;
}

/** The candidate list for a kind (taste is DB-backed via the service, rest are code tuples). */
async function candidatesFor(kind: CatalogKind, ctx: ToolCtx): Promise<Candidate[]> {
  if (kind !== 'taste') return codeCandidates(kind);
  const opts = await ctx.taste.options();
  return [...opts.cuisines, ...opts.dish_types, ...opts.ingredients];
}

/**
 * Grounds the model in the catalog before it commits a value: returns the candidates for
 * `kind` ranked by match to `query` (empty query → the full catalog), writing nothing.
 */
export async function execute(input: z.infer<typeof inputSchema>, ctx: ToolCtx): Promise<{ candidates: Candidate[] }> {
  const candidates = await candidatesFor(input.kind, ctx);
  return { candidates: rank(input.query, candidates) };
}

export const searchCatalogTool = createTool({
  id: 'search_catalog',
  description:
    'Ground a value against the catalog before saving it. Returns candidate {value,label} entries ' +
    'for the kind (taste|store|equipment|diet|allergen) ranked by match to the query; empty query ' +
    'returns the full catalog. Writes nothing.',
  inputSchema,
  execute: (input, ctx) => execute(input, ctx as unknown as ToolCtx),
});
