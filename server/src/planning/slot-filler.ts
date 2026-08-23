import type { MealSlot } from '../schema.js';
import type { CandidateRecipe, FillConstraints, PlanAssignment, Slot, SlotChoice, SlotFiller } from './types.js';
import { similarity } from './similarity.js';
import { MMR_LAMBDA, NEW_RATIO, LEFTOVER_BUDGET_FRACTION, MAX_BATCH_SPAN_DAYS, KEEPS_WELL_FITS } from './constants.js';

const MEAL_ORDER: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];
const TIME_SLOT_FOR_MEAL: Record<MealSlot, keyof NonNullable<FillConstraints['timeByMeal']>> = {
  breakfast: 'breakfast', lunch: 'lunch', dinner: 'dinner', snack: 'snack',
};

/** Days between two YYYY-MM-DD dates (UTC midnight, so DST-safe). */
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

/**
 * Option B core (WI-MP-2): fills slots by MMR with a familiar:new portfolio, repairs budget/time by
 * bounded swaps, then merges leftover/meal-prep batches. Pure and deterministic — same input, same plan.
 */
export class MmrFiller implements SlotFiller {
  static create(): MmrFiller {
    return new MmrFiller();
  }

  fill(slots: Slot[], pools: Map<MealSlot, CandidateRecipe[]>, constraints: FillConstraints): PlanAssignment {
    const total = slots.length;
    const targetNew = Math.round(total * NEW_RATIO);
    const byMeal = groupByMeal(slots);

    const used = new Set<string>();
    let choices: SlotChoice[] = [];
    let newPicked = 0;

    for (const meal of MEAL_ORDER) {
      const mealSlots = byMeal.get(meal) ?? [];
      const pool = pools.get(meal) ?? [];
      const chosen: CandidateRecipe[] = [];
      for (const slot of mealSlots) {
        const filled = choices.length;
        const pick = this.select(pool, used, chosen, {
          remainingSlots: total - filled,
          needNew: targetNew - newPicked,
          needFamiliar: total - targetNew - (filled - newPicked),
        });
        if (!pick) continue; // pool exhausted → slot stays unfilled (reported, never faked)
        choices.push({ slot, recipeId: pick.recipeId, tier: pick.tier, batchId: null });
        used.add(pick.recipeId);
        chosen.push(pick);
        if (!pick.familiar) newPicked++;
      }
    }

    choices = this.repair(choices, pools, constraints);
    choices = this.batch(choices, pools, constraints, total);
    return this.summarize(choices, pools, constraints, total);
  }

  /** MMR pick from the pool, honoring in-week uniqueness and the novelty floor/ceiling. */
  private select(
    pool: CandidateRecipe[],
    used: Set<string>,
    chosen: CandidateRecipe[],
    q: { remainingSlots: number; needNew: number; needFamiliar: number },
  ): CandidateRecipe | null {
    let available = pool.filter((c) => !used.has(c.recipeId));
    if (available.length === 0) return null;
    // Force the novelty floor when the remaining slots are exactly the outstanding quota.
    if (q.needNew > 0 && q.remainingSlots <= q.needNew) {
      const news = available.filter((c) => !c.familiar);
      if (news.length) available = news;
    } else if (q.needFamiliar > 0 && q.remainingSlots <= q.needFamiliar) {
      const fam = available.filter((c) => c.familiar);
      if (fam.length) available = fam;
    }
    let best = available[0];
    let bestScore = this.mmr(best, chosen);
    for (const c of available) {
      const s = this.mmr(c, chosen);
      if (s > bestScore) { best = c; bestScore = s; }
    }
    return best;
  }

  /** (1−λ)·base − λ·max similarity to an already-chosen same-meal recipe. */
  private mmr(c: CandidateRecipe, chosen: CandidateRecipe[]): number {
    const maxSim = chosen.reduce((m, o) => Math.max(m, similarity(c, o)), 0);
    return (1 - MMR_LAMBDA) * c.baseScore - MMR_LAMBDA * maxSim;
  }

  /**
   * Bounded local-search repair: while over the weekly budget, swap the costliest slot for the
   * same-meal candidate that saves the most cost per unit of base lost. Then a single time pass
   * swaps any over-time slot for a within-time alternative that does not break budget.
   * ponytail: greedy per-slot swaps with a full pool rescan each step — O(slots·pool) per fix,
   * fine at a week's scale; a priority queue if plans ever get huge.
   */
  private repair(choices: SlotChoice[], pools: Map<MealSlot, CandidateRecipe[]>, c: FillConstraints): SlotChoice[] {
    const out = [...choices];
    if (c.weeklyBudgetCents !== null) {
      const budget = c.weeklyBudgetCents;
      for (let guard = 0; guard < out.length * 4 && this.cost(out, pools, c) > budget; guard++) {
        const swap = this.bestCostSwap(out, pools, c);
        if (!swap) break;
        out[swap.index] = swap.choice;
      }
    }
    for (let i = 0; i < out.length; i++) {
      const alt = this.timeFixSwap(out, i, pools, c);
      if (alt) out[i] = alt;
    }
    return out;
  }

  /** The single most cost-efficient downgrade across all slots, or null if none reduces cost. */
  private bestCostSwap(
    out: SlotChoice[],
    pools: Map<MealSlot, CandidateRecipe[]>,
    c: FillConstraints,
  ): { index: number; choice: SlotChoice; efficiency: number } | null {
    const usedIds = new Set(out.map((o) => o.recipeId));
    let best: { index: number; choice: SlotChoice; efficiency: number } | null = null;
    out.forEach((choice, index) => {
      if (choice.batchId) return; // don't disturb a leftover batch
      const cur = candidateIn(pools, choice.slot.meal, choice.recipeId);
      const curCost = costOf(cur, c);
      for (const alt of pools.get(choice.slot.meal) ?? []) {
        if (usedIds.has(alt.recipeId)) continue;
        const saved = curCost - costOf(alt, c);
        if (saved <= 0) continue;
        const baseLoss = Math.max(cur ? cur.baseScore - alt.baseScore : 0, 0.0001);
        const efficiency = saved / baseLoss;
        if (!best || efficiency > best.efficiency) {
          best = { index, efficiency, choice: { ...choice, recipeId: alt.recipeId, tier: alt.tier } };
        }
      }
    });
    return best;
  }

  /** Swap an over-time slot for the highest-base within-time alternative that keeps the plan in budget. */
  private timeFixSwap(out: SlotChoice[], i: number, pools: Map<MealSlot, CandidateRecipe[]>, c: FillConstraints): SlotChoice | null {
    const choice = out[i];
    if (choice.batchId) return null;
    const budgetMin = timeBudgetFor(choice.slot.meal, c);
    const cur = candidateIn(pools, choice.slot.meal, choice.recipeId);
    if (budgetMin === null || !cur || cur.totalMinutes === null || cur.totalMinutes <= budgetMin) return null;
    const usedIds = new Set(out.map((o) => o.recipeId));
    let best: CandidateRecipe | null = null;
    for (const alt of pools.get(choice.slot.meal) ?? []) {
      if (usedIds.has(alt.recipeId) || alt.totalMinutes === null || alt.totalMinutes > budgetMin) continue;
      if (!best || alt.baseScore > best.baseScore) best = alt;
    }
    if (!best) return null;
    const trial = out.map((o, j) => (j === i ? { ...choice, recipeId: best!.recipeId, tier: best!.tier } : o));
    if (c.weeklyBudgetCents !== null && this.cost(trial, pools, c) > c.weeklyBudgetCents) return null;
    return { ...choice, recipeId: best.recipeId, tier: best.tier };
  }

  /**
   * Leftover / meal-prep batching (P7, D-05): when capacity is short or the user wants to meal-prep,
   * merge adjacent same-meal slots onto one keeps-well recipe (a shared batchId), bounded by the
   * leftover budget and the max batch span. Batched repeats are intentional, so they bypass the
   * in-week uniqueness rule.
   * ponytail: greedy best-anchor-first adjacent merge, not an optimal cook-count packing — enough
   * to close the capacity gap; the ILP (design Option C) would optimize this exactly.
   */
  private batch(choices: SlotChoice[], pools: Map<MealSlot, CandidateRecipe[]>, c: FillConstraints, total: number): SlotChoice[] {
    let budget = this.leftoverTarget(choices, c, total);
    if (budget <= 0) return choices;
    const out = [...choices];
    let batchSeq = 0;

    for (const meal of MEAL_ORDER) {
      if (budget <= 0) break;
      const idxs = out.map((ch, i) => (ch.slot.meal === meal ? i : -1)).filter((i) => i >= 0);
      const perMealCap = Math.floor(LEFTOVER_BUDGET_FRACTION * idxs.length);
      let madeThisMeal = 0;
      // Anchors: keeps-well recipes, best base first.
      const anchors = idxs
        .filter((i) => isKeepsWell(candidateIn(pools, meal, out[i].recipeId)))
        .sort((a, b) => baseOf(pools, meal, out[b].recipeId) - baseOf(pools, meal, out[a].recipeId));
      for (const anchorIdx of anchors) {
        if (budget <= 0 || madeThisMeal >= perMealCap) break;
        if (out[anchorIdx].batchId) continue; // already part of a batch
        const batchId = `b${batchSeq}`;
        let anchored = false;
        for (const j of idxs) {
          if (budget <= 0 || madeThisMeal >= perMealCap) break;
          if (j === anchorIdx || out[j].batchId) continue;
          if (Math.abs(daysBetween(out[anchorIdx].slot.date, out[j].slot.date)) > MAX_BATCH_SPAN_DAYS) continue;
          out[anchorIdx] = { ...out[anchorIdx], batchId };
          out[j] = { ...out[j], recipeId: out[anchorIdx].recipeId, tier: out[anchorIdx].tier, batchId };
          anchored = true;
          budget--; madeThisMeal++;
        }
        if (anchored) batchSeq++;
      }
    }
    return out;
  }

  /** How many slots to turn into leftovers: the capacity gap and/or the intent share, capped by budget. */
  private leftoverTarget(choices: SlotChoice[], c: FillConstraints, total: number): number {
    const distinctCooks = new Set(choices.map((ch) => ch.recipeId)).size;
    const capacity = c.eatsLeftovers && c.cookDaysCount !== null && distinctCooks > c.cookDaysCount
      ? distinctCooks - c.cookDaysCount : 0;
    const intent = c.mealPrepIntent
      ? Math.max(1, Math.round(LEFTOVER_BUDGET_FRACTION * total * (c.weightMealPrep / 3))) : 0;
    return Math.max(capacity, intent);
  }

  private cost(choices: SlotChoice[], pools: Map<MealSlot, CandidateRecipe[]>, c: FillConstraints): number {
    return choices.reduce((sum, ch) => sum + costOf(candidateIn(pools, ch.slot.meal, ch.recipeId), c), 0);
  }

  private summarize(choices: SlotChoice[], pools: Map<MealSlot, CandidateRecipe[]>, c: FillConstraints, total: number): PlanAssignment {
    const preferenceTotal = choices.reduce((s, ch) => s + baseOf(pools, ch.slot.meal, ch.recipeId), 0);
    const cooks = new Map<string, boolean>(); // recipeId → familiar
    for (const ch of choices) {
      const cand = candidateIn(pools, ch.slot.meal, ch.recipeId);
      if (cand) cooks.set(ch.recipeId, cand.familiar);
    }
    const newCooks = [...cooks.values()].filter((familiar) => !familiar).length;
    const batchSizes = new Map<string, number>();
    for (const ch of choices) if (ch.batchId) batchSizes.set(ch.batchId, (batchSizes.get(ch.batchId) ?? 0) + 1);
    const leftovers = [...batchSizes.values()].reduce((s, n) => s + (n - 1), 0);
    return {
      choices,
      summary: {
        preferenceTotal,
        costTotalCents: Math.round(this.cost(choices, pools, c)),
        noveltyRatio: cooks.size ? newCooks / cooks.size : 0,
        leftoverRatio: total ? leftovers / total : 0,
        unfilledSlots: total - choices.length,
      },
    };
  }
}

// ── pure helpers ────────────────────────────────────────────────────────────

function groupByMeal(slots: Slot[]): Map<MealSlot, Slot[]> {
  const m = new Map<MealSlot, Slot[]>();
  for (const s of slots) (m.get(s.meal) ?? m.set(s.meal, []).get(s.meal)!).push(s);
  for (const list of m.values()) list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return m;
}

const candidateIn = (pools: Map<MealSlot, CandidateRecipe[]>, meal: MealSlot, recipeId: string) =>
  (pools.get(meal) ?? []).find((c) => c.recipeId === recipeId) ?? null;

const baseOf = (pools: Map<MealSlot, CandidateRecipe[]>, meal: MealSlot, recipeId: string) =>
  candidateIn(pools, meal, recipeId)?.baseScore ?? 0;

/** Per-slot cost = per-serving cost × household servings; unknown cost counts as 0 (can't repair it). */
const costOf = (c: CandidateRecipe | null, k: FillConstraints) =>
  c && c.costPerServingCents !== null ? c.costPerServingCents * k.householdServings : 0;

const isKeepsWell = (c: CandidateRecipe | null) => !!c && c.mealPrepFit !== null && KEEPS_WELL_FITS.has(c.mealPrepFit);

function timeBudgetFor(meal: MealSlot, c: FillConstraints): number | null {
  if (c.timeByMeal) return c.timeByMeal[TIME_SLOT_FOR_MEAL[meal]];
  return c.timeBudgetMinutes;
}
