import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { migratedFileDb } from './helpers/migrated-db.js';
import { seedFdcFixture } from './fixtures/fdc-foods.fixture.js';
import { seedExtraAllergenFoods, seedAllergens, FIXTURE_ALLERGEN_ROWS } from './fixtures/allergen-foods.fixture.js';
import { AllergenDetector } from '../src/allergen/allergen-detector.js';
import { parseIngredientLine, type StructuredIngredient } from '../src/parse/ingredient.js';
import type { Allergen, RecipeAllergens } from '../src/allergen/allergen.js';
import type { Database } from '../src/db.js';

// Offline: real AllergenDetector over the WI-1 fixture + WI-3 allergen annotations on a
// migrated `file:` db. No network.

let db: Database;
let cleanup: () => void;
let detector: AllergenDetector;

function ings(...lines: string[]): StructuredIngredient[] {
  return lines.map(parseIngredientLine);
}

/** The allergens at a given presence, sorted — for exact-set comparison. */
function at(result: RecipeAllergens, presence: 'contains' | 'may_contain'): Allergen[] {
  return (Object.entries(result.presences) as [Allergen, string][])
    .filter(([, p]) => p === presence)
    .map(([a]) => a)
    .sort();
}

beforeAll(async () => {
  ({ db, cleanup } = await migratedFileDb());
  await seedFdcFixture(db);
  await seedExtraAllergenFoods(db);
  await seedAllergens(db, FIXTURE_ALLERGEN_ROWS);
  detector = AllergenDetector.create(db);
});

afterAll(() => cleanup());

describe('Test Case 1: detect positives', () => {
  it('reports contains for each recognized allergen-bearing food, complete=true', async () => {
    const r = (await detector.detect(ings('2 cups cultured buttermilk', '2 tbsp peanut butter')))!;
    expect(at(r, 'contains')).toEqual<Allergen[]>(['milk', 'peanut']);
    expect(at(r, 'may_contain')).toEqual([]);
    expect(r.complete).toBe(true);
  });
});

describe('Test Case 2: coverage asymmetry', () => {
  it('an unmatchable ingredient adds no positive and drops complete to false', async () => {
    const r = (await detector.detect(ings('2 cups cultured buttermilk', '3 sprigs zzzq unknownherb')))!;
    expect(at(r, 'contains')).toEqual<Allergen[]>(['milk']);
    expect(at(r, 'may_contain')).toEqual([]);
    expect(r.complete).toBe(false);
  });
});

describe('Test Case 3: merge precedence across ingredients', () => {
  it('contains beats may_contain for the same allergen', async () => {
    // Bare "milk" matches at `medium`, downgrading its `contains milk` to `may_contain`;
    // buttermilk matches `high` → `contains milk`. The merge must land on contains.
    const r = (await detector.detect(ings('1 cup milk', '2 cups cultured buttermilk')))!;
    expect(at(r, 'contains')).toEqual<Allergen[]>(['milk']);
    expect(at(r, 'may_contain')).toEqual([]);
    expect(r.complete).toBe(true);
  });
});

describe('Test Case 3b: medium-quality match softens contains to may_contain', () => {
  it('a lone medium match of a contains-annotated food yields may_contain, still recognized', async () => {
    // "butermilk" (typo) matches buttermilk by trigram only → `medium`; its `contains milk` softens.
    const r = (await detector.detect(ings('1 cup butermilk')))!;
    expect(at(r, 'contains')).toEqual([]);
    expect(at(r, 'may_contain')).toEqual<Allergen[]>(['milk']);
    expect(r.complete).toBe(true);
  });
});

describe('Test Case 4: empty list', () => {
  it('returns null', async () => {
    expect(await detector.detect([])).toBeNull();
  });
});

describe('Test Case 5: golden corpus (exact-set e2e)', () => {
  const corpus: {
    title: string;
    ingredients: string[];
    expect: { contains: Allergen[]; mayContain: Allergen[]; complete: boolean };
  }[] = JSON.parse(
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'allergen-recipes.json'), 'utf8'),
  );

  it.each(corpus)('$title', async (recipe) => {
    const r = (await detector.detect(ings(...recipe.ingredients)))!;
    expect(at(r, 'contains')).toEqual([...recipe.expect.contains].sort());
    expect(at(r, 'may_contain')).toEqual([...recipe.expect.mayContain].sort());
    expect(r.complete).toBe(recipe.expect.complete);
  });
});
