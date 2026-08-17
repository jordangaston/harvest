import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { migratedFileDb } from '../helpers/migrated-db.js';
import { seedFdcFixture } from '../fixtures/fdc-foods.fixture.js';
import { FdcFoodRepository } from '../../src/nutrition/fdc-food-repository.js';
import { FoodMatcher } from '../../src/nutrition/food-matcher.js';
import { insertFdcFoods, toFdcFoodRow } from '../../scripts/build-fdc-catalog.js';
import type { Database } from '../../src/db.js';

/**
 * E2E matching coverage over the importer's real-style recipes (AC-7). It is the gap-finder
 * for normalizer misses and missing synonyms: it runs every ingredient line through the
 * matcher and asserts a corpus coverage FLOOR (not exact macros — there is no accuracy SLA).
 *
 * Two paths, both OFFLINE (no network — the catalog is committed/local test data):
 *   - default: seed the WI-1 FIXTURE (~12 foods) and assert the mechanism (known foods match,
 *     gibberish doesn't). This runs in the normal `npm run test` suite and in CI.
 *   - full seed: gated behind `describe.skipIf(!process.env.FNDDS_JSON)`. The 66MB FNDDS JSON
 *     is NOT committed, so this block is SKIPPED offline. Point `FNDDS_JSON` at the export to
 *     run the real coverage floor. (Skipped ≠ failing — confirm with `npm run test`.)
 */

interface Recipe {
  title: string;
  ingredients: string[];
}

const HERE = dirname(fileURLToPath(import.meta.url));
const RECIPES: Recipe[] = JSON.parse(
  readFileSync(join(HERE, '..', 'fixtures', 'e2e-recipes.json'), 'utf8'),
).recipes;

// Coverage floor over the corpus. tunable (Q-01/Q-06) — a conservative starting value that
// passes on the current seed; raise it as the normalizer/synonyms improve.
const MIN_MATCH_RATE_FIXTURE = 0.7;
const MIN_MATCH_RATE_FULL = 0.7;

/** Runs every ingredient through the matcher, logging a per-recipe report; returns the rate. */
async function reportCoverage(matcher: FoodMatcher, label: string): Promise<number> {
  let total = 0;
  let matched = 0;
  const lines: string[] = [];
  for (const recipe of RECIPES) {
    const results: string[] = [];
    for (const ingredient of recipe.ingredients) {
      total++;
      const m = await matcher.match(ingredient);
      if (m) {
        matched++;
        results.push(`  ✓ ${ingredient} → fdc ${m.fdcId} (${m.quality})`);
      } else {
        results.push(`  ✗ ${ingredient} → UNMATCHED`);
      }
    }
    lines.push(`[${recipe.title}]`, ...results);
  }
  const rate = total === 0 ? 0 : matched / total;
  // eslint-disable-next-line no-console
  console.log(`\n=== ${label}: ${matched}/${total} matched (${(rate * 100).toFixed(0)}%) ===\n${lines.join('\n')}`);
  return rate;
}

describe('E2E matching coverage — FIXTURE seed (offline, default)', () => {
  let db: Database;
  let cleanup: () => void;
  let matcher: FoodMatcher;

  beforeAll(async () => {
    ({ db, cleanup } = await migratedFileDb());
    await seedFdcFixture(db);
    matcher = FoodMatcher.create(FdcFoodRepository.create(db));
  });
  afterAll(() => cleanup());

  it('matches known fixture foods across the corpus above the floor', async () => {
    const rate = await reportCoverage(matcher, 'fixture');
    expect(rate).toBeGreaterThanOrEqual(MIN_MATCH_RATE_FIXTURE);
  });

  it('does not match gibberish (mechanism check)', async () => {
    expect(await matcher.match('qwzptx flooble')).toBeNull();
  });
});

// Real coverage floor over the FULL FNDDS seed. Skipped offline (JSON not committed).
describe.skipIf(!process.env.FNDDS_JSON)('E2E matching coverage — FULL FNDDS seed', () => {
  let db: Database;
  let cleanup: () => void;
  let matcher: FoodMatcher;

  beforeAll(async () => {
    ({ db, cleanup } = await migratedFileDb());
    const raw = JSON.parse(readFileSync(process.env.FNDDS_JSON!, 'utf8')) as {
      SurveyFoods: Parameters<typeof toFdcFoodRow>[0][];
    };
    const foods = raw.SurveyFoods.filter((f) => f?.fdcId && f.description).map(toFdcFoodRow);
    await insertFdcFoods(db, foods);
    matcher = FoodMatcher.create(FdcFoodRepository.create(db));
  }, 300_000);
  afterAll(() => cleanup?.());

  it('clears the corpus coverage floor against the real catalog', async () => {
    const rate = await reportCoverage(matcher, 'full');
    expect(rate).toBeGreaterThanOrEqual(MIN_MATCH_RATE_FULL);
  });
});
