import { eq } from 'drizzle-orm';
import type { Database } from '../db.js';
import { fdcFoodAllergen } from '../schema.js';
import type { Allergen, AllergenPresence } from './allergen.js';

/** One annotated allergen for a recognized food. */
export interface AllergenHit {
  allergen: Allergen;
  presence: AllergenPresence;
  species: string | null;
}

/** Reads `fdc_food_allergen`: the allergen set keyed to a recognized food's `fdc_id`. */
export class AllergenRepository {
  constructor(private readonly db: Database) {}

  /** Wire from a caller-supplied db (tests pass a local `file:` db). */
  static create(db: Database): AllergenRepository {
    return new AllergenRepository(db);
  }

  /** The food's annotated allergens (empty when the food carries none). */
  async allergensFor(fdcId: number): Promise<AllergenHit[]> {
    return this.db
      .select({
        allergen: fdcFoodAllergen.allergen,
        presence: fdcFoodAllergen.presence,
        species: fdcFoodAllergen.species,
      })
      .from(fdcFoodAllergen)
      .where(eq(fdcFoodAllergen.fdcId, fdcId));
  }
}
