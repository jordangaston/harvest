import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../db.js';
import { fdcFoods, fdcFoodNutrient, type FdcPortion } from '../schema.js';

/** One FTS5 search hit: the food plus its raw bm25 (lower = better) for the matcher to tier on. */
export interface FdcFoodCandidate {
  fdcId: number;
  description: string;
  descriptionNormalized: string;
  category: string | null;
  bm25: number;
}

/** Zod parse of one FTS5 candidate row at the DB→domain boundary. */
const CandidateRowSchema = z.object({
  fdc_id: z.number(),
  description: z.string(),
  description_normalized: z.string(),
  category: z.string().nullable(),
  bm25: z.number(),
});

/** Zod parse of one nutrient row; `amount_per_100g` is stored as text (pg numeric). */
const NutrientRowSchema = z.object({
  nutrientNumber: z.string(),
  amountPer100g: z.string(),
});

/** Overlapping 3-grams of a word (the tokenizer FTS5 uses). Empty for words < 3 chars. */
function trigrams(word: string): string[] {
  const grams: string[] = [];
  for (let i = 0; i + 3 <= word.length; i++) grams.push(word.slice(i, i + 3));
  return grams;
}

/**
 * Reads the WI-1 FNDDS catalog: FTS5 search over `description_normalized`, plus a food's
 * nutrient panel and portions. Search queries the trigram FTS mirror via raw SQL (Drizzle
 * `db.all`); reads go through the typed tables. Rows are Zod-parsed at the boundary.
 */
export class FdcFoodRepository {
  constructor(private readonly db: Database) {}

  /** Wire from a caller-supplied db (tests pass a local `file:` db). */
  static create(db: Database): FdcFoodRepository {
    return new FdcFoodRepository(db);
  }

  /**
   * FTS5 search: each token is expanded to its trigrams and OR-ed, so a doc sharing more
   * of the query's trigrams ranks better (this is what gives typo tolerance — a bare-term
   * trigram MATCH requires *every* trigram, so a single wrong letter matches nothing).
   * @param tokens - normalized tokens (from `normalize()`), so they tokenize like the catalog.
   * @returns candidates ordered by bm25 ascending (best first); empty for no tokens/no hits.
   */
  async search(tokens: string[]): Promise<FdcFoodCandidate[]> {
    const grams = tokens.flatMap(trigrams);
    if (grams.length === 0) return [];
    const matchExpr = grams.map((g) => `"${g}"`).join(' OR ');
    const rows = await this.db.all(sql`
      SELECT f.fdc_id AS fdc_id, f.description AS description,
             f.description_normalized AS description_normalized, f.category AS category,
             bm25(fdc_foods_fts) AS bm25
      FROM fdc_foods_fts
      JOIN fdc_foods f ON f.fdc_id = fdc_foods_fts.rowid
      WHERE fdc_foods_fts MATCH ${matchExpr}
      ORDER BY bm25`);
    return rows.map((r) => {
      const p = CandidateRowSchema.parse(r);
      return {
        fdcId: p.fdc_id,
        description: p.description,
        descriptionNormalized: p.description_normalized,
        category: p.category,
        bm25: p.bm25,
      };
    });
  }

  /** The food's nutrient panel as `nutrientNumber → amountPer100g` (numbers parsed from text). */
  async nutrients(fdcId: number): Promise<Map<string, number>> {
    const rows = await this.db
      .select({ nutrientNumber: fdcFoodNutrient.nutrientNumber, amountPer100g: fdcFoodNutrient.amountPer100g })
      .from(fdcFoodNutrient)
      .where(eq(fdcFoodNutrient.fdcId, fdcId));
    return new Map(rows.map((r) => NutrientRowSchema.parse(r)).map((r) => [r.nutrientNumber, Number(r.amountPer100g)]));
  }

  /** The food's normalized description (the `normalize()`-joined tokens); '' if not found. */
  async descriptionNormalized(fdcId: number): Promise<string> {
    const [row] = await this.db
      .select({ descriptionNormalized: fdcFoods.descriptionNormalized })
      .from(fdcFoods)
      .where(eq(fdcFoods.fdcId, fdcId))
      .limit(1);
    return row?.descriptionNormalized ?? '';
  }

  /** The food's stored gram-weight portions (empty array when the food has none). */
  async portions(fdcId: number): Promise<FdcPortion[]> {
    const [row] = await this.db
      .select({ portions: fdcFoods.portions })
      .from(fdcFoods)
      .where(eq(fdcFoods.fdcId, fdcId))
      .limit(1);
    return row?.portions ?? [];
  }
}
