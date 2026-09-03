import type { Database } from '../../db.js';

/** A drizzle transaction client. */
type TxClient = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * The executor a persist runs under: an interactive transaction, or the bare `db` (repo-backed
 * types open their own transaction, so they ignore this and run on `db` directly — matching the
 * `UserRepository.setName` executor convention). Only tx-backed persists (name/goals) use it.
 */
export type Tx = TxClient | Database;

/** Which household or member a fact's value belongs to (each `persist`/`read` switches on it). */
export type Subject =
  | { scope: 'household'; householdId: string }
  | { scope: 'member'; userId: string };

/** The three shapes a fact's value can take, steering the model's grounding. */
export type Flavor = 'enum' | 'catalog' | 'scalar';

/** How the type reads to the model: enumerable legal values, or a scalar's parse rule. */
export interface TypeDoc {
  name: string;
  flavor: Flavor;
  description: string;
  /** Legal values (enum/catalog); absent for scalar. A page of them when catalog-large. */
  values?: { value: string; label: string }[];
  /** The scalar's parse rule (scalar only), e.g. "a dollar amount → whole cents". */
  rule?: string;
  pageToken?: string;
}

/** A page of legal catalog/enum values, cursor-paginated. */
export interface ValuePage {
  values: { value: string; label: string }[];
  pageToken?: string;
}

/** validate → normalize → persist verdict. A pass carries the normalized value. */
export type ValidateResult =
  | { ok: true }
  | { ok: false; reason: string; missing?: string[]; closest?: string[] };

/**
 * A typed datum's owner: validation, normalization, legal-value search, and persistence to its
 * domain table. Static `name`/`flavor`/`describe`; dynamic `search`/`read`/`persist` may hit the DB
 * or a catalog service. `validate` guards the rich rules (allergen confirmed+severity, catalog
 * grounding); `normalize` shapes the raw value into what `persist` writes.
 */
export interface FactType {
  readonly name: string;
  readonly flavor: Flavor;
  describe(): TypeDoc;
  validate(value: unknown): ValidateResult;
  normalize(value: unknown): unknown;
  /** Enumerate/ground legal values (enum/catalog only); scalar types omit it. */
  search?(query: string, pageToken?: string): Promise<ValuePage> | ValuePage;
  persist(subject: Subject, value: unknown, tx: Tx): Promise<void>;
  read(subject: Subject): Promise<unknown>;
}
