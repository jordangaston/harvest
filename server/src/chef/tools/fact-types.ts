import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import type { Database } from '../../db.js';
import { FactTypeRegistry } from '../facts/fact-types.js';
import { FactRegistry } from '../facts/registry.js';
import { score, slugify, type Candidate } from './catalog.js';
import type { ChefTool, TurnContext } from './types.js';

const inputSchema = z.object({
  key: z.string().optional(),
  query: z.string().optional(),
  page_token: z.string().optional(),
});

/** The args `fact_types` runs a 2×2 over: an optional fact key, phrase, and page cursor. */
type FactTypesArgs = { key?: string; query?: string; page_token?: string };

/** How many enumerated values to return per page before handing back a `page_token`. */
const PAGE_SIZE = 25;
/** Ground only offers matches at or above this prefix-overlap score (mirrors catalog's floor). */
const GROUND_FLOOR = 0.5;

type BrowseResponse = { kind: 'browse'; facts: { key: string; flavor: string; description: string }[] };
type DescribeResponse = { kind: 'describe'; key: string; flavor: string; description: string; values?: Candidate[]; rule?: string; page_token?: string };
type GroundResponse = { kind: 'ground'; matches: { value: string; key: string; score: number }[] };
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
  private readonly factRegistry: FactRegistry;

  private constructor(db: Database) {
    this.factTypes = FactTypeRegistry.create(db);
    this.factRegistry = FactRegistry.create();
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
        'Look up a fact\'s legal values, or ground a loose phrase to a canonical one, before you write — ' +
        'an off-catalog value is rejected. Address a fact by the SAME key read_facts shows (e.g. ' +
        'allergens, food_preferences); plural/singular and case don\'t matter. No args browses every ' +
        'fact; `key` alone describes one (its values or scalar rule); `query` alone grounds a phrase ' +
        'across all facts (ranked); both search one fact\'s values. Always pass `key` when you know it — ' +
        'a bare `query` is the expensive cross-fact fallback. Long lists page via page_token. Reads only.',
      inputSchema,
      execute: async (input) => this.run(input),
    });
  }

  async run({ key, query, page_token }: FactTypesArgs): Promise<FactTypesResponse> {
    if (key && query) return this.search(key, query, page_token);
    if (key) return this.describe(key, page_token);
    if (query) return this.ground(query);
    return this.browse();
  }

  /** The writable facts the model can address, keyed as read_facts shows them, with each type's flavor. */
  private browse(): BrowseResponse {
    const facts = this.factRegistry
      .list()
      .filter((d) => d.access === 'writable')
      .map((d) => ({ key: d.key, flavor: this.factTypes.get(d.factType)?.flavor ?? 'unknown', description: d.description }));
    return { kind: 'browse', facts };
  }

  private describe(loose: string, pageToken?: string): DescribeResponse {
    const def = this.factRegistry.resolve(loose);
    const type = def && this.factTypes.get(def.factType);
    if (!def || !type) return { kind: 'describe', key: loose, flavor: 'unknown', description: `no such fact "${loose}"` };
    const doc = type.describe();
    const base = { kind: 'describe' as const, key: def.key, flavor: doc.flavor, description: doc.description };
    if (doc.rule) return { ...base, rule: doc.rule };
    const page = paginate(doc.values ?? [], pageToken);
    return { ...base, values: page.items, page_token: page.next };
  }

  /** Rank a loose phrase against every enumerable fact's values, cross-fact, keeping the canonical key. */
  private ground(query: string): GroundResponse {
    const slug = slugify(query);
    const keyByType = new Map(this.factRegistry.list().map((d) => [d.factType, d.key]));
    const matches: { value: string; key: string; score: number }[] = [];
    for (const { name } of this.factTypes.list()) {
      const key = keyByType.get(name);
      if (!key) continue; // a type with no writable key — the model can't address it
      const values = this.factTypes.get(name)?.describe().values;
      if (!values) continue; // scalar type — nothing to ground against
      for (const cand of values) {
        const s = score(slug, cand);
        if (s >= GROUND_FLOOR) matches.push({ value: cand.value, key, score: s });
      }
    }
    matches.sort((a, b) => b.score - a.score);
    return { kind: 'ground', matches: matches.slice(0, PAGE_SIZE) };
  }

  private async search(loose: string, query: string, pageToken?: string): Promise<SearchResponse> {
    const def = this.factRegistry.resolve(loose);
    const type = def && this.factTypes.get(def.factType);
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
