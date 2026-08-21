import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createClient } from '@libsql/client';
import pluralize from 'pluralize';
import { eq, isNotNull } from 'drizzle-orm';
import { makeDb, type Database } from '../src/db.js';
import { fdcFoods, tasteIngredients } from '../src/schema.js';

/**
 * Curation: collapse the ~5.4k FNDDS foods into a few-hundred base ingredients keyed by the
 * FNDDS food code, then stamp each food's `base_ingredient_id`. GENERATE == REGENERATE — one
 * idempotent command (wipe + repopulate in ONE transaction). To recalibrate, edit
 * `seed/taste-overrides.json` and re-run `npm run seed:taste`. Run AFTER `seed:reference`
 * (which captures `food_code`/`wweia_category_code`).
 *
 * See docs/ranking/taste-classification-affinity.md § Ingredient Curation.
 */

/** One food the curation reads (from `fdc_foods`). */
export interface CurationFood {
  fdcId: number;
  foodCode: number | null;
  category: string | null; // the WWEIA category description (sections/excludes, doesn't name)
  description: string;
}

/** The hand-authored calibration config (`seed/taste-overrides.json`). */
export interface TasteOverrides {
  // Substring match (case-insensitive) — use unambiguous multi-word phrases only.
  excludeCategoryContains: string[];
  // Whole-category-name match (case-insensitive), for ambiguous single words like "water"/"other".
  excludeCategoryExact: string[];
  excludeFoodGroups: number[];
  // Case-insensitive substrings that, when present in the de-qualified base name, mark it a
  // composite dish rather than a base ingredient (e.g. " and ", " or ", " with ").
  excludeNameContains: string[];
  qualifiers: string[];
  merges: Record<string, string>;
  keepSplit: string[];
  labels: Record<string, string>;
  sectionByFoodGroup: Record<string, string>;
}

/** A curated cluster: its new id, display label, section, FNDDS major group, and members. */
export interface CuratedIngredient {
  id: string;
  label: string;
  section: string;
  foodGroup: number;
  fdcIds: number[];
}

/** The curation result: the base ingredients and the per-food base_ingredient_id stamps. */
export interface CurationResult {
  ingredients: CuratedIngredient[];
  stamps: { fdcId: number; baseIngredientId: string }[];
}

/** The 8-digit food code, left-padded so slicing is deterministic. */
function digits(foodCode: number): string {
  return String(foodCode).padStart(8, '0');
}

/** FNDDS major group = the food code's first digit (1–9). */
export function foodGroupOf(foodCode: number): number {
  return Number(digits(foodCode)[0]);
}

/** FNDDS subgroup = the food code's first 4 digits — the false-merge guard (coconut milk
 * and dairy milk share "milk" but differ here, so they never cluster together). */
export function subgroupOf(foodCode: number): string {
  return digits(foodCode).slice(0, 4);
}

/**
 * De-qualify one FNDDS description to a base name: drop parentheticals, keep the head
 * (comma-first) segment, strip the qualifier lexicon (multi-word phrases first, then single
 * words), singularize, and collapse whitespace. Returns '' when nothing survives.
 */
export function deQualify(description: string, qualifiers: string[]): string {
  let head = description.toLowerCase().replace(/\([^)]*\)/g, ' ').split(',')[0] ?? '';
  // Strip multi-word qualifier phrases first (longest → shortest) so "from concentrate" goes
  // before "concentrate"; then drop single-word qualifiers token-by-token.
  const phrases = [...qualifiers].filter((q) => q.includes(' ')).sort((a, b) => b.length - a.length);
  for (const p of phrases) head = head.replace(new RegExp(`\\b${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), ' ');
  const singles = new Set(qualifiers.filter((q) => !q.includes(' ')));
  const words = head
    .replace(/[^a-z\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !singles.has(w))
    .map((w) => pluralize.singular(w));
  return words.join(' ').trim();
}

/** Title-cases a base name for display (e.g. `bell pepper` → `Bell Pepper`). */
function titleCase(name: string): string {
  return name.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Whether a food is excluded (non-ingredient: mixed dishes, baby food, water, other, …). */
function isExcluded(food: CurationFood, overrides: TasteOverrides): boolean {
  if (food.foodCode == null) return true;
  if (overrides.excludeFoodGroups.includes(foodGroupOf(food.foodCode))) return true;
  const category = (food.category ?? '').toLowerCase().trim();
  if (overrides.excludeCategoryExact.some((k) => category === k.toLowerCase())) return true;
  return overrides.excludeCategoryContains.some((k) => category.includes(k.toLowerCase()));
}

/**
 * Pure curation: cluster foods by (food group, de-qualified base name), applying merge rules,
 * into base ingredients with a fresh uuid each. `newId` is injected so tests are deterministic.
 * Keying on the food GROUP (not the finer subgroup) merges one ingredient that spans several
 * subgroups — e.g. chicken across its many 4-digit subgroups — into a single base ingredient;
 * a distinct base name (e.g. "coconut milk" vs "milk") is what keeps genuinely different foods
 * apart, so the group is a sufficient guard. Foods without a food code, matching an exclusion,
 * or whose base name reads as a composite dish are dropped (not stamped).
 */
export function curate(foods: CurationFood[], overrides: TasteOverrides, newId: () => string): CurationResult {
  const clusters = new Map<string, { label: string; section: string; foodGroup: number; fdcIds: number[] }>();
  for (const food of foods) {
    if (isExcluded(food, overrides)) continue;
    const rawName = deQualify(food.description, overrides.qualifiers);
    if (!rawName) continue;
    if (overrides.excludeNameContains.some((c) => rawName.includes(c))) continue; // composite dish, not an ingredient
    const baseName = overrides.merges[rawName] ?? rawName;
    const group = foodGroupOf(food.foodCode!);
    const key = `${group}::${baseName}`;
    const existing = clusters.get(key);
    if (existing) existing.fdcIds.push(food.fdcId);
    else
      clusters.set(key, {
        label: overrides.labels[baseName] ?? titleCase(baseName),
        section: overrides.sectionByFoodGroup[String(group)] ?? `Group ${group}`,
        foodGroup: group,
        fdcIds: [food.fdcId],
      });
  }

  // Merge clusters that surface under the same display label — one ingredient USDA files under two
  // food groups (lima bean as legume + starchy vegetable; chicken and its meatless analogue). One
  // entry per label; section/group follow the food group contributing the most members.
  const byLabel = new Map<string, { label: string; section: string; foodGroup: number; fdcIds: number[]; dominant: number }>();
  for (const cluster of clusters.values()) {
    const ex = byLabel.get(cluster.label);
    if (!ex) {
      byLabel.set(cluster.label, { ...cluster, dominant: cluster.fdcIds.length });
    } else {
      ex.fdcIds.push(...cluster.fdcIds);
      if (cluster.fdcIds.length > ex.dominant) {
        ex.section = cluster.section;
        ex.foodGroup = cluster.foodGroup;
        ex.dominant = cluster.fdcIds.length;
      }
    }
  }

  const ingredients: CuratedIngredient[] = [];
  const stamps: { fdcId: number; baseIngredientId: string }[] = [];
  for (const cluster of byLabel.values()) {
    const id = newId();
    ingredients.push({ id, label: cluster.label, section: cluster.section, foodGroup: cluster.foodGroup, fdcIds: cluster.fdcIds });
    for (const fdcId of cluster.fdcIds) stamps.push({ fdcId, baseIngredientId: id });
  }
  return { ingredients, stamps };
}

const OVERRIDES_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'seed', 'taste-overrides.json');

/** Loads the calibration config. */
export function loadOverrides(): TasteOverrides {
  return JSON.parse(readFileSync(OVERRIDES_PATH, 'utf8')) as TasteOverrides;
}

/**
 * Persists a curation result: in ONE transaction, wipe `taste_ingredients` (and clear every
 * `fdc_foods.base_ingredient_id`), insert the new base ingredients, and re-stamp each food.
 * The wipe-first FK cleanup is what makes regeneration fail-safe (a stale user-pref uuid then
 * matches no row and contributes nothing). Returns the ingredient count.
 */
export async function persistCuration(db: Database, result: CurationResult): Promise<number> {
  await db.transaction(async (tx) => {
    await tx.update(fdcFoods).set({ baseIngredientId: null }).where(isNotNull(fdcFoods.baseIngredientId));
    await tx.delete(tasteIngredients);
    for (let i = 0; i < result.ingredients.length; i += 500) {
      const chunk = result.ingredients.slice(i, i + 500);
      await tx.insert(tasteIngredients).values(chunk.map((c) => ({ id: c.id, label: c.label, section: c.section, foodGroup: c.foodGroup })));
    }
    for (const stamp of result.stamps) {
      await tx.update(fdcFoods).set({ baseIngredientId: stamp.baseIngredientId }).where(eq(fdcFoods.fdcId, stamp.fdcId));
    }
  });
  return result.ingredients.length;
}

/** Step-7 QA: cluster count in a sane band, and every non-excluded food stamped. Throws on failure. */
function assertQa(foods: CurationFood[], overrides: TasteOverrides, result: CurationResult): void {
  const count = result.ingredients.length;
  if (count < 200 || count > 1000) throw new Error(`curation QA: ${count} base ingredients is outside the sane band [200, 1000] — tune taste-overrides.json`);
  const eligible = foods.filter((f) => {
    if (isExcluded(f, overrides)) return false;
    const name = deQualify(f.description, overrides.qualifiers);
    // Mirror curate(): a food with no base name, or one that reads as a composite dish, is dropped.
    return Boolean(name) && !overrides.excludeNameContains.some((c) => name.includes(c));
  });
  const stamped = new Set(result.stamps.map((s) => s.fdcId));
  const unmapped = eligible.filter((f) => !stamped.has(f.fdcId));
  if (unmapped.length) throw new Error(`curation QA: ${unmapped.length} non-excluded foods were not mapped to a base ingredient`);
}

async function main(): Promise<void> {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) {
    console.error('TURSO_DATABASE_URL is required (e.g. the `turso dev` URL, or the Turso DB).');
    process.exit(1);
  }
  const db = makeDb(createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN }));
  const foods = (await db
    .select({ fdcId: fdcFoods.fdcId, foodCode: fdcFoods.foodCode, category: fdcFoods.category, description: fdcFoods.description })
    .from(fdcFoods)) as CurationFood[];
  if (foods.length === 0) {
    console.error('No fdc_foods rows — run `npm run seed:reference` first.');
    process.exit(1);
  }
  const overrides = loadOverrides();
  const result = curate(foods, overrides, () => crypto.randomUUID());
  assertQa(foods, overrides, result);
  const n = await persistCuration(db, result);
  console.log(`✓ taste    → ${n} base ingredients (taste_ingredients) from ${foods.length} foods; ${result.stamps.length} foods stamped`);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) await main();
