import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import type { Database } from '../../db.js';
import { FactTypeRegistry } from '../facts/fact-types.js';
import { score, slugify, type Candidate } from './catalog.js';
import type { ChefTool, TurnContext } from './types.js';

const inputSchema = z.object({
  fact_type: z.string().optional(),
  query: z.string().optional(),
  page_token: z.string().optional(),
});

/** The args `fact_types` runs a 2×2 over: an optional type, phrase, and page cursor. */
type FactTypesArgs = { fact_type?: string; query?: string; page_token?: string };

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
 * response carries a `kind` tag; large enumerations page via `page_token`. Grounds loose phrases
 * against the catalogs. Writes nothing.
 */
export class FactTypesTool implements ChefTool {
  readonly id = 'fact_types';

  private readonly factTypes: FactTypeRegistry;

  private constructor(db: Database) {
    this.factTypes = FactTypeRegistry.create(db);
  }

  // `_ctx` is unused: fact_types reads no mutable turn data, only the db-wired registry.
  static create(_ctx: TurnContext, db: Database): FactTypesTool {
    return new FactTypesTool(db);
  }

  canRun(): boolean {
    return true;
  }

  asMastraTool() {
    return createTool({
      id: this.id,
      description:
        'Look up a fact type\'s legal values, or ground a loose phrase to a canonical one, before you ' +
        'write — an off-catalog value is rejected. No args browses every type; `fact_type` alone ' +
        'describes one (its values or scalar rule); `query` alone grounds a phrase across all types ' +
        '(ranked); both search one type\'s values. Always pass `fact_type` when you know it — a bare ' +
        '`query` is the expensive cross-type fallback. Long lists page via page_token. Reads only.',
      inputSchema,
      execute: async (input) => this.run(input),
    });
  }

  async run({ fact_type, query, page_token }: FactTypesArgs): Promise<FactTypesResponse> {
    if (fact_type && query) return this.search(fact_type, query, page_token);
    if (fact_type) return this.describe(fact_type, page_token);
    if (query) return this.ground(query);
    return this.browse();
  }

  private browse(): BrowseResponse {
    return { kind: 'browse', types: this.factTypes.list() };
  }

  private describe(name: string, pageToken?: string): DescribeResponse {
    const type = this.factTypes.get(name);
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
    for (const { name } of this.factTypes.list()) {
      const values = this.factTypes.get(name)?.describe().values;
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
    const type = this.factTypes.get(name);
    if (!type?.search) return { kind: 'search', matches: [] };
    const result = await type.search(query, pageToken);
    return { kind: 'search', matches: result.values, page_token: result.pageToken };
  }
}

/**
 * ponytail: naive offset paging over an in-memory value list — the token is an opaque base64url
 * offset. A malformed token decodes to 0 (start over) rather than throwing.
 */
function paginate(items: Candidate[], pageToken?: string): { items: Candidate[]; next?: string } {
  const start = decodeOffset(pageToken);
  const slice = items.slice(start, start + PAGE_SIZE);
  const nextIndex = start + PAGE_SIZE;
  return { items: slice, next: nextIndex < items.length ? encodeOffset(nextIndex) : undefined };
}

const encodeOffset = (n: number): string => Buffer.from(String(n)).toString('base64url');
function decodeOffset(token?: string): number {
  if (!token) return 0;
  const n = Number.parseInt(Buffer.from(token, 'base64url').toString(), 10);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}
