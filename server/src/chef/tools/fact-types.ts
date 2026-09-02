import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { score, slugify, type Candidate } from './catalog.js';
import type { ChefTool, SaveResult, TurnContext } from './types.js';

const inputSchema = z.object({
  fact_type: z.string().optional(),
  query: z.string().optional(),
  page_token: z.string().optional(),
});

/** How many enumerated values to return per page before handing back a `page_token`. */
const PAGE_SIZE = 25;
/** Ground only offers matches at or above this prefix-overlap score (mirrors catalog's floor). */
const GROUND_FLOOR = 0.5;

type BrowseResponse = { kind: 'browse'; types: { name: string; flavor: string; description: string }[] };
type DescribeResponse = { kind: 'describe'; name: string; flavor: string; description: string; values?: Candidate[]; rule?: string; page_token?: string };
type GroundResponse = { kind: 'ground'; matches: { value: string; fact_type: string; score: number }[] };
type SearchResponse = { kind: 'search'; matches: Candidate[]; page_token?: string };
type FactTypesResponse = BrowseResponse | DescribeResponse | GroundResponse | SearchResponse;

/**
 * The model's window into the fact-type system — one tool, a 2×2 over `(fact_type?, query?)`:
 * neither browses the catalog of types; a `fact_type` alone describes it (its legal values or scalar
 * rule); a `query` alone grounds a loose phrase cross-type; both search one type's values. Every
 * response carries a `kind` tag; large enumerations page via `page_token`. Folds in the old
 * `search_catalog` grounding. Writes nothing.
 */
export class FactTypesTool implements ChefTool {
  readonly id = 'fact_types';
  readonly saved: SaveResult[] = []; // discovery never writes

  private constructor(private readonly ctx: TurnContext) {}

  static create(ctx: TurnContext): FactTypesTool {
    return new FactTypesTool(ctx);
  }

  canRun(): boolean {
    return true;
  }

  asMastraTool() {
    return createTool({
      id: this.id,
      description:
        'Discover fact types and their legal values. No args: browse all types. `fact_type` only: ' +
        'describe that type (its values or scalar rule). `query` only: ground a loose phrase across ' +
        'types (ranked). Both: search one type for matching values. Pass `fact_type` whenever you ' +
        'know it — a bare `query` is the expensive cross-type fallback. Large lists page via page_token.',
      inputSchema,
      execute: async (input) => this.run(input),
    });
  }

  async run({ fact_type, query, page_token }: { fact_type?: string; query?: string; page_token?: string }): Promise<FactTypesResponse> {
    if (fact_type && query) return this.search(fact_type, query, page_token);
    if (fact_type) return this.describe(fact_type, page_token);
    if (query) return this.ground(query);
    return this.browse();
  }

  private browse(): BrowseResponse {
    return { kind: 'browse', types: this.ctx.factTypes.list() };
  }

  private describe(name: string, pageToken?: string): DescribeResponse {
    const type = this.ctx.factTypes.get(name);
    if (!type) return { kind: 'describe', name, flavor: 'unknown', description: `no such fact type "${name}"` };
    const doc = type.describe();
    const base = { kind: 'describe' as const, name: doc.name, flavor: doc.flavor, description: doc.description };
    if (doc.rule) return { ...base, rule: doc.rule };
    const page = paginate(doc.values ?? [], pageToken);
    return { ...base, values: page.items, page_token: page.next };
  }

  /** Rank a loose phrase against every enumerable type's values, cross-type, keeping the fact_type. */
  private ground(query: string): GroundResponse {
    const slug = slugify(query);
    const matches: { value: string; fact_type: string; score: number }[] = [];
    for (const { name } of this.ctx.factTypes.list()) {
      const values = this.ctx.factTypes.get(name)?.describe().values;
      if (!values) continue; // scalar type — nothing to ground against
      for (const cand of values) {
        const s = score(slug, cand);
        if (s >= GROUND_FLOOR) matches.push({ value: cand.value, fact_type: name, score: s });
      }
    }
    matches.sort((a, b) => b.score - a.score);
    return { kind: 'ground', matches: matches.slice(0, PAGE_SIZE) };
  }

  private async search(name: string, query: string, pageToken?: string): Promise<SearchResponse> {
    const type = this.ctx.factTypes.get(name);
    if (!type?.search) return { kind: 'search', matches: [] };
    const result = await type.search(query, pageToken);
    return { kind: 'search', matches: result.values, page_token: result.pageToken };
  }
}

/** ponytail: naive offset paging over an in-memory value list — the token is just the next index. */
function paginate(items: Candidate[], pageToken?: string): { items: Candidate[]; next?: string } {
  const start = pageToken ? Number.parseInt(pageToken, 10) || 0 : 0;
  const slice = items.slice(start, start + PAGE_SIZE);
  const nextIndex = start + PAGE_SIZE;
  return { items: slice, next: nextIndex < items.length ? String(nextIndex) : undefined };
}
