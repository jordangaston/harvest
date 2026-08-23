import { describe, it, expect } from 'vitest';
import type { MealSlot } from '../src/schema.js';
import { MmrFiller } from '../src/planning/slot-filler.js';
import { SingleUserAggregator } from '../src/planning/score-aggregator.js';
import { similarity } from '../src/planning/similarity.js';
import type { CandidateRecipe, FillConstraints, Slot } from '../src/planning/types.js';

/** WI-MP-2 — pure MmrFiller: MMR selection, novelty portfolio, budget/time repair, P7 batching. */

let seq = 0;
function cand(o: Partial<CandidateRecipe> = {}): CandidateRecipe {
  return {
    recipeId: o.recipeId ?? `r${seq++}`,
    tier: 'global',
    baseScore: 10,
    costPerServingCents: 300,
    totalMinutes: 30,
    mealPrepFit: null,
    categories: { cuisine: [], dishType: [], primaryIngredient: [] },
    familiar: true,
    ...o,
  };
}

const italian = () => ({ cuisine: ['italian'], dishType: ['pasta'], primaryIngredient: ['wheat'] });
const varied = (i: number) => ({ cuisine: [`c${i}`], dishType: [`d${i}`], primaryIngredient: [`p${i}`] });

function slots(meal: MealSlot, dates: string[]): Slot[] {
  return dates.map((date) => ({ date, meal }));
}
function pools(entries: [MealSlot, CandidateRecipe[]][]): Map<MealSlot, CandidateRecipe[]> {
  return new Map(entries);
}
function constraints(o: Partial<FillConstraints> = {}): FillConstraints {
  return {
    weeklyBudgetCents: null,
    timeByMeal: null,
    timeBudgetMinutes: null,
    householdServings: 1,
    cookDaysCount: null,
    eatsLeftovers: true,
    mealPrepIntent: false,
    weightMealPrep: 1,
    ...o,
  };
}

const week = (n: number) => Array.from({ length: n }, (_, i) => `2026-08-${String(3 + i).padStart(2, '0')}`);
const totalPairSim = (cs: CandidateRecipe[]) => {
  let s = 0;
  for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) s += similarity(cs[i], cs[j]);
  return s;
};

describe('MmrFiller — selection', () => {
  it('prefers the higher tier even when a lower tier ranks higher, never duplicates, is deterministic (AC4, AC11)', () => {
    const imported = cand({ recipeId: 'imp', tier: 'imported', baseScore: 30.5, categories: varied(1) }); // tier30 + rank .5
    const global = cand({ recipeId: 'glob', tier: 'global', baseScore: 0.9, categories: varied(2) }); // rank .9, no tier
    const filler = MmrFiller.create();
    const input = () => filler.fill(slots('dinner', week(1)), pools([['dinner', [imported, global]]]), constraints());

    const a = input();
    expect(a.choices).toHaveLength(1);
    expect(a.choices[0].recipeId).toBe('imp'); // tier dominates rank
    expect(input()).toEqual(a); // deterministic
  });

  it('leaves a slot unfilled rather than duplicating when the pool is too thin (AC10)', () => {
    const only = cand({ recipeId: 'one', categories: varied(1) });
    const res = MmrFiller.create().fill(slots('dinner', week(3)), pools([['dinner', [only]]]), constraints());
    expect(res.choices).toHaveLength(1);
    expect(res.summary.unfilledSlots).toBe(2);
    expect(new Set(res.choices.map((c) => c.recipeId)).size).toBe(1); // no dup fabricated
  });

  it('diversifies away from near-duplicates via MMR (AC5)', () => {
    const sim = [
      cand({ recipeId: 'a', baseScore: 20.5, categories: italian() }),
      cand({ recipeId: 'b', baseScore: 20.4, categories: italian() }),
      cand({ recipeId: 'c', baseScore: 20.3, categories: italian() }),
    ];
    const div = [
      cand({ recipeId: 'd', baseScore: 20.2, categories: varied(1) }),
      cand({ recipeId: 'e', baseScore: 20.1, categories: varied(2) }),
    ];
    const res = MmrFiller.create().fill(slots('dinner', week(3)), pools([['dinner', [...sim, ...div]]]), constraints());
    const chosen = res.choices.map((ch) => [...sim, ...div].find((c) => c.recipeId === ch.recipeId)!);
    expect(totalPairSim(chosen)).toBeLessThan(totalPairSim(sim)); // less redundant than the top-3-by-base
  });

  it('hits the familiar:new novelty target within one slot (AC6)', () => {
    const fam = Array.from({ length: 8 }, (_, i) => cand({ recipeId: `f${i}`, baseScore: 20 - i * 0.01, familiar: true, categories: varied(i) }));
    const neu = Array.from({ length: 4 }, (_, i) => cand({ recipeId: `n${i}`, baseScore: 19 - i * 0.01, familiar: false, categories: varied(100 + i) }));
    const res = MmrFiller.create().fill(slots('dinner', week(10)), pools([['dinner', [...fam, ...neu]]]), constraints());
    const newPicked = res.choices.filter((ch) => neu.some((n) => n.recipeId === ch.recipeId)).length;
    expect(newPicked).toBeGreaterThanOrEqual(2); // target round(10*0.3)=3, ±1
    expect(newPicked).toBeLessThanOrEqual(4);
  });
});

describe('MmrFiller — repair', () => {
  it('repairs an over-budget fill down to budget when feasible (AC7)', () => {
    const p = [
      cand({ recipeId: 'x', baseScore: 20.5, costPerServingCents: 600, categories: varied(1) }),
      cand({ recipeId: 'y', baseScore: 20.4, costPerServingCents: 600, categories: varied(2) }),
      cand({ recipeId: 'z', baseScore: 20.0, costPerServingCents: 100, categories: varied(3) }),
    ];
    const res = MmrFiller.create().fill(slots('dinner', week(2)), pools([['dinner', p]]), constraints({ weeklyBudgetCents: 800 }));
    expect(res.summary.costTotalCents).toBeLessThanOrEqual(800);
    expect(res.choices).toHaveLength(2);
  });

  it('reports the overrun (no throw, no empty) when no within-budget plan exists (AC7)', () => {
    const p = [
      cand({ recipeId: 'x', baseScore: 20.5, costPerServingCents: 600, categories: varied(1) }),
      cand({ recipeId: 'y', baseScore: 20.4, costPerServingCents: 600, categories: varied(2) }),
    ];
    const res = MmrFiller.create().fill(slots('dinner', week(2)), pools([['dinner', p]]), constraints({ weeklyBudgetCents: 800 }));
    expect(res.choices).toHaveLength(2);
    expect(res.summary.costTotalCents).toBe(1200); // > budget, honestly reported
  });
});

describe('MmrFiller — leftover/meal-prep batching (P7)', () => {
  const keepsWell = (id: string, base: number, i: number) => cand({ recipeId: id, baseScore: base, mealPrepFit: 'designed', categories: varied(i) });
  const fresh = (id: string, base: number, i: number) => cand({ recipeId: id, baseScore: base, mealPrepFit: 'unsuitable', categories: varied(100 + i) });

  it('batches keeps-well recipes when capacity is short, never the unsuitable ones, bounded by budget/span (AC8, AC9)', () => {
    const p = [
      keepsWell('k0', 20.5, 0), keepsWell('k1', 20.4, 1), keepsWell('k2', 20.3, 2),
      fresh('u0', 20.2, 0), fresh('u1', 20.1, 1), fresh('u2', 20.0, 2),
    ];
    const res = MmrFiller.create().fill(
      slots('dinner', week(6)),
      pools([['dinner', p]]),
      constraints({ cookDaysCount: 3, eatsLeftovers: true }),
    );
    const batched = res.choices.filter((c) => c.batchId);
    expect(batched.length).toBeGreaterThan(0);
    expect(res.summary.leftoverRatio).toBeGreaterThan(0);
    // Every batched slot references a keeps-well recipe (never an unsuitable one).
    const keepsWellIds = new Set(['k0', 'k1', 'k2']);
    expect(batched.every((c) => keepsWellIds.has(c.recipeId))).toBe(true);
    // Per-meal leftover budget: floor(0.4 * 6) = 2.
    const leftovers = res.choices.filter((c) => c.batchId).length - new Set(res.choices.filter((c) => c.batchId).map((c) => c.batchId)).size;
    expect(leftovers).toBeLessThanOrEqual(2);
  });

  it('anchors the batch on the highest meal-prep score, not the highest base', () => {
    // A `suitable` recipe outranks a `designed` one on base — but the designed one is more batchable,
    // so it must be the anchor the leftovers serve.
    const p = [
      cand({ recipeId: 'suit', baseScore: 20.5, mealPrepFit: 'suitable', categories: varied(1) }),
      cand({ recipeId: 'design', baseScore: 20.0, mealPrepFit: 'designed', categories: varied(2) }),
      cand({ recipeId: 'suit2', baseScore: 19.0, mealPrepFit: 'suitable', categories: varied(3) }),
    ];
    const res = MmrFiller.create().fill(
      slots('dinner', week(3)),
      pools([['dinner', p]]),
      constraints({ cookDaysCount: 1, eatsLeftovers: true }),
    );
    const batched = res.choices.filter((c) => c.batchId);
    expect(batched.length).toBeGreaterThan(0);
    expect(batched.every((c) => c.recipeId === 'design')).toBe(true); // designed anchors, not the higher-base suitable
  });

  it('batches on meal-prep intent even with ample capacity (AC8)', () => {
    const p = [keepsWell('k0', 20.5, 0), keepsWell('k1', 20.4, 1), keepsWell('k2', 20.3, 2), keepsWell('k3', 20.2, 3)];
    const res = MmrFiller.create().fill(
      slots('dinner', week(4)),
      pools([['dinner', p]]),
      constraints({ cookDaysCount: 10, mealPrepIntent: true, weightMealPrep: 3 }),
    );
    expect(res.summary.leftoverRatio).toBeGreaterThan(0);
  });

  it('does not batch when capacity is null and there is no intent (AC9)', () => {
    const p = [cand({ recipeId: 'k0', mealPrepFit: 'designed', categories: varied(0) }), cand({ recipeId: 'k1', mealPrepFit: 'designed', categories: varied(1) })];
    const res = MmrFiller.create().fill(slots('dinner', week(2)), pools([['dinner', p]]), constraints({ cookDaysCount: null, mealPrepIntent: false }));
    expect(res.summary.leftoverRatio).toBe(0);
    expect(res.choices.every((c) => c.batchId === null)).toBe(true);
  });
});

describe('SingleUserAggregator', () => {
  it('is the identity of the single member score (AC12)', () => {
    expect(SingleUserAggregator.create().aggregate([5])).toBe(5);
    expect(SingleUserAggregator.create().aggregate([])).toBe(0);
  });
});
