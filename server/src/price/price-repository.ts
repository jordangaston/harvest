import { eq } from 'drizzle-orm';
import type { Database } from '../db.js';
import { fdcFoodPrice } from '../schema.js';

/**
 * Reads the WI-CS-1 price catalog: one food's raw PP-NAP `price_per_100g` (2017–18
 * USD-per-100-edible-gram, numeric-as-text). CPI aging + cents rounding happen at
 * read time in `CostEstimator`, so this returns the stored text verbatim.
 */
export class PriceRepository {
  constructor(private readonly db: Database) {}

  /** Wire from a caller-supplied db (tests pass a local `file:` db). */
  static create(db: Database): PriceRepository {
    return new PriceRepository(db);
  }

  /**
   * @param fdcId - the matched food's FDC id.
   * @returns the raw `price_per_100g` text, or null when the food has no price row.
   */
  async pricePer100g(fdcId: number): Promise<string | null> {
    const [row] = await this.db
      .select({ pricePer100g: fdcFoodPrice.pricePer100g })
      .from(fdcFoodPrice)
      .where(eq(fdcFoodPrice.fdcId, fdcId))
      .limit(1);
    return row?.pricePer100g ?? null;
  }
}
