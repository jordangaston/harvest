import { describe, it, expect } from 'vitest';
import type { UserPreferences } from '../src/models/user-preferences.js';
import type { RankableRecipe } from '../src/ranking/types.js';
import { AllergenFilter, DietFilter } from '../src/ranking/filters.js';
import {
  CostScorer, DifficultyScorer, NutritionScorer, AffinityScorer, TimeScorer, PopularityScorer,
} from '../src/ranking/scorers.js';
import { RankingEngine } from '../src/ranking/ranking-engine.js';

/** WI-RANK-2 — pure RankingEngine: scorer normalization, filters, combination, penalties, tie-breaks, worked example. */

function rankableRecipe(overrides: Partial<RankableRecipe> = {}): RankableRecipe {
  return {
    id: 'r1',
    createdAt: new Date('2026-01-01'),
    costPerServingCents: 300,
    difficultyBand: 'intermediate',
    nrfScore: 50,
    totalMinutes: 30,
    categories: { cuisine: [], dishType: [], primaryIngredient: [] },
    allergens: { contains: [], mayContain: [], complete: true },
    dietFit: {},
    popularity: null,
    ...overrides,
  };
}

function preferences(overrides: Partial<UserPreferences> = {}): UserPreferences {
  return {
    userId: 'u1',
    skillLevel: 'intermediate',
    budgetCentsPerServing: 400,
    timeBudgetMinutes: 30,
    weights: { cost: 1, difficulty: 1, nutrition: 1, affinity: 1, time: 1, popularity: 0 },
    allergens: [],
    diets: [],
    foodPrefs: [],
    ...overrides,
  };
}

const round1 = (x: number) => Math.round(x * 100 * 10) / 10;

describe('scorer normalization (Test Case 1)', () => {
  const p = preferences();

  it('cost: at budget → 1, at 2× → 0, under → 1, null → null', () => {
    const cost = new CostScorer();
    expect(cost.score(rankableRecipe({ costPerServingCents: 400 }), p)).toBe(1);
    expect(cost.score(rankableRecipe({ costPerServingCents: 800 }), p)).toBe(0);
    expect(cost.score(rankableRecipe({ costPerServingCents: 200 }), p)).toBe(1);
    expect(cost.score(rankableRecipe({ costPerServingCents: null }), p)).toBeNull();
    expect(cost.score(rankableRecipe(), preferences({ budgetCentsPerServing: null }))).toBeNull();
  });

  it('time: symmetric to cost', () => {
    const time = new TimeScorer();
    expect(time.score(rankableRecipe({ totalMinutes: 30 }), p)).toBe(1);
    expect(time.score(rankableRecipe({ totalMinutes: 60 }), p)).toBe(0);
    expect(time.score(rankableRecipe({ totalMinutes: null }), p)).toBeNull();
  });

  it('difficulty: match → 1, one-easier → 0.85, two-harder → 0.20, null → null', () => {
    const diff = new DifficultyScorer();
    expect(diff.score(rankableRecipe({ difficultyBand: 'intermediate' }), p)).toBe(1);
    expect(diff.score(rankableRecipe({ difficultyBand: 'beginner' }), p)).toBe(0.85);
    expect(diff.score(rankableRecipe({ difficultyBand: 'advanced' }), preferences({ skillLevel: 'beginner' }))).toBe(0.2);
    expect(diff.score(rankableRecipe({ difficultyBand: null }), p)).toBeNull();
  });

  it('nutrition: 0 → 0, 57 → 0.5, 250 → ≈0.814, negative → 0, null → null', () => {
    const n = new NutritionScorer();
    expect(n.score(rankableRecipe({ nrfScore: 0 }))).toBe(0);
    expect(n.score(rankableRecipe({ nrfScore: 57 }))).toBe(0.5);
    expect(n.score(rankableRecipe({ nrfScore: 250 }))!).toBeCloseTo(0.814, 3);
    expect(n.score(rankableRecipe({ nrfScore: -10 }))).toBe(0);
    expect(n.score(rankableRecipe({ nrfScore: null }))).toBeNull();
  });

  it('affinity: all-liked → 1, all-neutral → 0.5, all-disliked → 0, no categories → null', () => {
    const aff = new AffinityScorer();
    const liked = preferences({ foodPrefs: [{ facet: 'cuisine', value: 'italian', sentiment: 'like' }] });
    const disliked = preferences({ foodPrefs: [{ facet: 'cuisine', value: 'italian', sentiment: 'dislike' }] });
    const italian = rankableRecipe({ categories: { cuisine: ['italian'], dishType: [], primaryIngredient: [] } });
    expect(aff.score(italian, liked)).toBe(1);
    expect(aff.score(italian, p)).toBe(0.5);
    expect(aff.score(italian, disliked)).toBe(0);
    expect(aff.score(rankableRecipe(), p)).toBeNull();
  });

  it('popularity: always null', () => {
    expect(new PopularityScorer().score()).toBeNull();
  });
});

describe('allergen filter matrix (Test Case 2)', () => {
  const contains = rankableRecipe({ allergens: { contains: ['peanut'], mayContain: [], complete: true } });
  const may = rankableRecipe({ allergens: { contains: [], mayContain: ['peanut'], complete: true } });
  const incomplete = rankableRecipe({ allergens: { contains: [], mayContain: [], complete: false } });
  const filter = new AllergenFilter();
  const withSeverity = (s: 'severe' | 'moderate' | 'mild') =>
    preferences({ allergens: [{ allergen: 'peanut', severity: s }] });

  it('severe excludes contains, mayContain and incomplete', () => {
    const p = withSeverity('severe');
    expect(filter.excludes(contains, p)).toBe(true);
    expect(filter.excludes(may, p)).toBe(true);
    expect(filter.excludes(incomplete, p)).toBe(true);
  });

  it('moderate excludes only contains', () => {
    const p = withSeverity('moderate');
    expect(filter.excludes(contains, p)).toBe(true);
    expect(filter.excludes(may, p)).toBe(false);
    expect(filter.excludes(incomplete, p)).toBe(false);
  });

  it('mild excludes none', () => {
    const p = withSeverity('mild');
    expect(filter.excludes(contains, p)).toBe(false);
    expect(filter.excludes(may, p)).toBe(false);
    expect(filter.excludes(incomplete, p)).toBe(false);
  });
});

describe('diet filter matrix (Test Case 3)', () => {
  const filter = new DietFilter();
  const incompatible = rankableRecipe({ dietFit: { vegan: 'incompatible' } });
  const unknown = rankableRecipe({ dietFit: { vegan: 'unknown' } });

  it('strict excludes incompatible, keeps unknown', () => {
    const p = preferences({ diets: [{ dietId: 'vegan', strictness: 'strict' }] });
    expect(filter.excludes(incompatible, p)).toBe(true);
    expect(filter.excludes(unknown, p)).toBe(false);
  });

  it('flexible excludes neither', () => {
    const p = preferences({ diets: [{ dietId: 'vegan', strictness: 'flexible' }] });
    expect(filter.excludes(incompatible, p)).toBe(false);
    expect(filter.excludes(unknown, p)).toBe(false);
  });
});

describe('combination (Test Case 4)', () => {
  const engine = RankingEngine.create();

  it('drops null signals from the denominator', () => {
    const recipe = rankableRecipe({
      nrfScore: null,
      costPerServingCents: 400, difficultyBand: 'intermediate', totalMinutes: 30,
      categories: { cuisine: ['italian'], dishType: [], primaryIngredient: [] },
    });
    const [ranked] = engine.rank([recipe], preferences());
    expect(ranked.breakdown).not.toHaveProperty('nutrition');
    // 4 available signals (cost, difficulty, affinity, time), each weight 1.
    expect(Object.keys(ranked.breakdown)).toHaveLength(4);
  });

  it('empty available set → score 0', () => {
    const recipe = rankableRecipe({
      costPerServingCents: null, difficultyBand: null, nrfScore: null, totalMinutes: null,
    });
    const [ranked] = engine.rank([recipe], preferences());
    expect(ranked.score).toBe(0);
  });
});

describe('soft penalties stack and floor (Test Case 5)', () => {
  const engine = RankingEngine.create();

  it('subtracts mild-allergen and flexible-incompatible penalties', () => {
    const recipe = rankableRecipe({
      costPerServingCents: 400, difficultyBand: 'intermediate', nrfScore: 57, totalMinutes: 30,
      categories: { cuisine: ['italian'], dishType: [], primaryIngredient: [] },
      allergens: { contains: ['peanut'], mayContain: [], complete: true },
      dietFit: { vegan: 'incompatible' },
    });
    const prefs = preferences({
      allergens: [{ allergen: 'peanut', severity: 'mild' }],
      diets: [{ dietId: 'vegan', strictness: 'flexible' }],
    });
    // average = (1 + 1 + 0.5 + 0.5 + 1)/5 = 0.8; penalties 0.15 + 0.20.
    const [ranked] = engine.rank([recipe], prefs);
    expect(ranked.score).toBeCloseTo(0.8 - 0.15 - 0.2, 6);
  });

  it('floors at 0, never negative', () => {
    const recipe = rankableRecipe({
      costPerServingCents: 800, difficultyBand: 'advanced', nrfScore: 0, totalMinutes: 60,
      categories: { cuisine: ['italian'], dishType: [], primaryIngredient: [] },
      allergens: { contains: ['peanut'], mayContain: [], complete: true },
    });
    const prefs = preferences({
      skillLevel: 'beginner',
      foodPrefs: [{ facet: 'cuisine', value: 'italian', sentiment: 'dislike' }],
      allergens: [{ allergen: 'peanut', severity: 'mild' }],
    });
    const [ranked] = engine.rank([recipe], prefs);
    expect(ranked.score).toBe(0);
  });
});

describe('tie-break ordering (Test Case 6)', () => {
  const engine = RankingEngine.create();

  it('higher coverage first, then newer createdAt, then id ascending', () => {
    // Both score 1.0: perfect cost. One also has difficulty (higher coverage).
    const base = {
      costPerServingCents: 200, nrfScore: null, totalMinutes: null,
      categories: { cuisine: [], dishType: [], primaryIngredient: [] } as RankableRecipe['categories'],
    };
    const lowCoverage = rankableRecipe({ id: 'a', difficultyBand: null, ...base });
    const highCoverage = rankableRecipe({ id: 'b', difficultyBand: 'intermediate', ...base });
    const prefs = preferences({ weights: { cost: 1, difficulty: 1, nutrition: 0, affinity: 0, time: 0, popularity: 0 } });
    const ranked = engine.rank([lowCoverage, highCoverage], prefs);
    expect(ranked.map((r) => r.recipeId)).toEqual(['b', 'a']);
  });

  it('equal coverage → newer createdAt, then id ascending', () => {
    const mk = (id: string, createdAt: Date) =>
      rankableRecipe({ id, createdAt, costPerServingCents: 200, difficultyBand: null, nrfScore: null, totalMinutes: null });
    const prefs = preferences({ weights: { cost: 1, difficulty: 0, nutrition: 0, affinity: 0, time: 0, popularity: 0 } });
    const older = mk('z', new Date('2026-01-01'));
    const newer = mk('a', new Date('2026-06-01'));
    expect(engine.rank([older, newer], prefs).map((r) => r.recipeId)).toEqual(['a', 'z']);

    const same = new Date('2026-01-01');
    expect(engine.rank([mk('b', same), mk('a', same)], prefs).map((r) => r.recipeId)).toEqual(['a', 'b']);
  });
});

describe('worked-example regression (Test Case 7)', () => {
  const alice = preferences({
    userId: 'alice',
    skillLevel: 'intermediate',
    budgetCentsPerServing: 400,
    timeBudgetMinutes: 30,
    weights: { cost: 3, difficulty: 1, nutrition: 3, affinity: 2, time: 2, popularity: 0 },
    allergens: [{ allergen: 'peanut', severity: 'severe' }],
    diets: [],
    foodPrefs: [
      { facet: 'cuisine', value: 'italian', sentiment: 'like' },
      { facet: 'primary_ingredient', value: 'chicken', sentiment: 'like' },
      { facet: 'primary_ingredient', value: 'liver', sentiment: 'dislike' },
    ],
  });

  const r1 = rankableRecipe({
    id: 'R1', createdAt: new Date('2026-01-01'),
    costPerServingCents: 350, difficultyBand: 'intermediate', nrfScore: 45, totalMinutes: 25,
    categories: { cuisine: ['italian'], dishType: ['pan-fry'], primaryIngredient: ['chicken'] },
  });
  const r2 = rankableRecipe({
    id: 'R2', createdAt: new Date('2026-01-02'),
    costPerServingCents: 500, difficultyBand: 'advanced', nrfScore: 30, totalMinutes: 40,
    categories: { cuisine: ['thai'], dishType: [], primaryIngredient: ['shrimp'] },
    allergens: { contains: ['peanut'], mayContain: [], complete: true },
  });
  const r3 = rankableRecipe({
    id: 'R3', createdAt: new Date('2026-01-03'),
    costPerServingCents: 250, difficultyBand: 'beginner', nrfScore: 70, totalMinutes: 45,
    categories: { cuisine: ['italian'], dishType: ['soup'], primaryIngredient: ['beans'] },
  });

  it('filters R2, orders [R1, R3], scores 81.7 and 71.2', () => {
    const ranked = RankingEngine.create().rank([r1, r2, r3], alice);
    expect(ranked.map((r) => r.recipeId)).toEqual(['R1', 'R3']);
    expect(round1(ranked[0].score)).toBe(81.7);
    expect(round1(ranked[1].score)).toBe(71.2);
  });
});
