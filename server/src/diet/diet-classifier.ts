import type { Database } from '../db.js';
import type { StructuredIngredient } from '../parse/ingredient.js';
import type { LabelCoreText, LabelCoreValues } from '../models/label-core.js';
import { FdcFoodRepository } from '../nutrition/fdc-food-repository.js';
import { FoodMatcher, type IngredientMatcher } from '../nutrition/food-matcher.js';
import { NutritionEstimator } from '../nutrition/nutrition-estimator.js';
import { foodClassFromName, foodClassFromCategory, type FoodClass } from './food-class-map.js';
import { DIET_RULES, type DietRule, type MacroRule } from './diet-rules.js';
import type { Blocker, DietCompat, Verdict } from './diet.js';

/** An ingredient reduced to what the diet rules read: its diet food-class (if any) and
 * whether we recognized it at all. Unrecognized ingredients only drop coverage; they
 * never invent a "clear". */
interface ClassifiedIngredient {
  name: string;
  cls: FoodClass | null;
  recognized: boolean;
}

/**
 * DietClassifier (WI-DS-1) — an ISOLATED signal. It reads only the raw recipe
 * (ingredients, servings, source-published nutrition) and regenerates everything it needs:
 * its own `FoodMatcher` pass for food-classes and its own `NutritionEstimator` run for net
 * carbs. It consumes no other pipeline step's output (DESIGN D-00), so a failed/withheld
 * nutrition step can't degrade a verdict.
 *
 * Fail-safe (D-04): a found blocker → `incompatible` (definitive from one ingredient); a
 * clean recipe with full coverage → `compatible`; a clean recipe with an unrecognized
 * ingredient → `unknown`, never a false `compatible`. Missing macros → keto/low-carb
 * `unknown`, never `incompatible`.
 */
export class DietClassifier {
  private constructor(
    private readonly matcher: IngredientMatcher,
    private readonly estimator: NutritionEstimator,
    private readonly rules: DietRule[] = DIET_RULES,
  ) {}

  static create(db: Database): DietClassifier {
    const matcher = FoodMatcher.create(FdcFoodRepository.create(db));
    return new DietClassifier(matcher, NutritionEstimator.create(db));
  }

  /**
   * @param ingredients - the recipe's structured ingredients.
   * @param servings - servings to divide macro totals by (net carbs are per-serving).
   * @param published - source-published per-serving macros, when the recipe carried them.
   * @returns a verdict per configured diet, or null when there are no ingredients to reason about.
   */
  async classify(
    ingredients: StructuredIngredient[],
    servings: number | null,
    published?: LabelCoreText,
  ): Promise<DietCompat | null> {
    if (ingredients.length === 0) return null;

    const classified = await this.classifyIngredients(ingredients);
    const coverageComplete = classified.every((c) => c.recognized);
    // Own net-carb basis — a private estimator run, never the nutritionStep's estimate.
    const macros = (await this.estimator.run(ingredients, servings, published)).nutrition?.values;

    const fit: Record<string, Verdict> = {};
    const blockers: Record<string, Blocker> = {};
    for (const rule of this.rules) {
      const blocker = findBlocker(rule, classified);
      if (blocker) {
        fit[rule.id] = 'incompatible';
        blockers[rule.id] = blocker;
      } else if (rule.macro) {
        const macro = macroVerdict(rule.macro, macros);
        fit[rule.id] = macro.verdict;
        if (macro.blocker) blockers[rule.id] = macro.blocker;
      } else {
        fit[rule.id] = coverageComplete ? 'compatible' : 'unknown';
      }
    }
    const foodClasses = [...new Set(classified.map((c) => c.cls).filter((c): c is FoodClass => c !== null))];
    return { fit, blockers, coverageComplete, foodClasses };
  }

  /** Its own match pass: name-first food-class, category fallback, recognition tier. */
  private async classifyIngredients(ingredients: StructuredIngredient[]): Promise<ClassifiedIngredient[]> {
    return Promise.all(
      ingredients.map(async (ing) => {
        const match = await this.matcher.match(ing.name);
        const matched = match !== null && match.quality !== 'low';
        const nameCls = foodClassFromName(ing.name);
        const cls = nameCls ?? (matched ? foodClassFromCategory(match!.category) : null);
        return { name: ing.name, cls, recognized: matched || nameCls !== null };
      }),
    );
  }
}

/** Whole-word, case-insensitive test of `word` (may contain spaces) in `text`. */
function has(text: string, word: string): boolean {
  return new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text);
}

/** The first ingredient that disqualifies `rule` — a hidden-ingredient name hit, or a
 * blocked food-class — or null. A name hit is definitive even without an FDC match. */
function findBlocker(rule: DietRule, ingredients: ClassifiedIngredient[]): Blocker | null {
  for (const ing of ingredients) {
    if (rule.blockedIngredients.some((kw) => has(ing.name, kw))) {
      return { kind: 'ingredient', value: ing.name, class: 'hidden' };
    }
    if (ing.cls && rule.blockedClasses.includes(ing.cls)) {
      return { kind: 'ingredient', value: ing.name, class: ing.cls };
    }
  }
  return null;
}

/** Round to one decimal for a readable blocker value. */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** A macro diet's verdict from the per-serving macros. Missing basis → `unknown`. */
function macroVerdict(macro: MacroRule, values?: LabelCoreValues): { verdict: Verdict; blocker?: Blocker } {
  const carbs = num(values?.grams_of_carbohydrate);
  if (macro.netCarbsMaxPerServing != null) {
    if (carbs == null) return { verdict: 'unknown' };
    const net = Math.max(0, carbs - (num(values?.grams_of_fiber) ?? 0));
    return net <= macro.netCarbsMaxPerServing
      ? { verdict: 'compatible' }
      : { verdict: 'incompatible', blocker: { kind: 'macro', value: `net_carbs≈${round1(net)}g` } };
  }
  if (macro.maxCarbShareOfCalories != null) {
    const cals = num(values?.calories);
    if (carbs == null || cals == null || cals <= 0) return { verdict: 'unknown' };
    const share = (carbs * 4) / cals;
    return share <= macro.maxCarbShareOfCalories
      ? { verdict: 'compatible' }
      : { verdict: 'incompatible', blocker: { kind: 'macro', value: `carbs≈${Math.round(share * 100)}%_of_calories` } };
  }
  return { verdict: 'unknown' };
}

/** A stored numeric-string macro → number, or null when absent/blank. */
function num(v: string | null | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
