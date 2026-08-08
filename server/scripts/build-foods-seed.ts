/**
 * Build server/seed/foods.json — the in-memory nutrition catalog (C5a) — from the
 * USDA FoodData Central JSON exports (SR Legacy base + Foundation overlay).
 *
 * Usage: tsx scripts/build-foods-seed.ts <sr_legacy.json> <foundation.json>
 *
 * The raw source files are large (SR Legacy ~210 MB) and are NOT committed. They
 * parse fine through `jq` (~6 s), which we shell out to for field projection so
 * Node never holds the whole 210 MB. Nutrition values are USDA per-100 g, taken
 * verbatim; a missing nutrient stays null (never fabricated). Portions/gram-weights
 * are USDA reference data; a small hand table backfills count/cup weights for the
 * common countable produce + dry goods so `toGrams` resolves them (Architect M4).
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { normalizeTokens } from '../src/nutrition/food-catalog.js';

// The 8 Nutrition-Facts label-core nutrients, by FDC nutrient id → our column key.
const NUTRIENT_BY_ID: Record<number, string> = {
  1008: 'calories',
  1003: 'grams_of_protein',
  1004: 'grams_of_fat',
  1005: 'grams_of_carbohydrate',
  1079: 'grams_of_fiber',
  2000: 'grams_of_sugar',
  1258: 'grams_of_saturated_fat',
  1093: 'milligrams_of_sodium',
};
const LABEL_KEYS = Object.values(NUTRIENT_BY_ID);
const NUTRIENT_IDS = Object.keys(NUTRIENT_BY_ID).join(',');

// Common-cooking categories to keep; everything else (Fast Foods, Baby Foods,
// Snacks, Beverages, prepared meals, branded lines) is dropped.
const KEEP_CATEGORIES = new Set([
  'Vegetables and Vegetable Products', 'Fruits and Fruit Juices', 'Dairy and Egg Products',
  'Poultry Products', 'Beef Products', 'Pork Products', 'Lamb, Veal, and Game Products',
  'Finfish and Shellfish Products', 'Legumes and Legume Products', 'Cereal Grains and Pasta',
  'Nut and Seed Products', 'Fats and Oils', 'Spices and Herbs', 'Baked Products',
]);

const NAME_NOISE = new Set([
  'raw', 'cooked', 'fresh', 'frozen', 'canned', 'dried', 'dehydrated', 'boiled', 'baked', 'roasted',
  'drained', 'unprepared', 'prepared', 'uncooked', 'enriched', 'unenriched', 'bleached', 'unbleached',
  'fortified', 'unfortified', 'regular', 'commercial', 'commercially', 'all', 'classes', 'composite',
  'trimmed', 'retail', 'cuts', 'separable', 'lean', 'only', 'skin', 'meat', 'nfs', 'ns', 'form', 'as',
  'to', 'with', 'without', 'added', 'no', 'includes', 'from', 'type', 'usda', 'commodity', 'reduced',
  'mature', 'seeds', 'kernels', 'solids', 'liquids', 'not', 'or', 'fluid', 'liquid', 'flesh',
]);
const NAME_STOP_HEAD = /\d|%|\(|\)|\//;
const BRAND_RE = /pillsbury|kraft|general mills|kellogg|quaker|nestle|campbell|betty crocker|®|™|brand|\bpost\b|hormel|oscar mayer|tyson/i;
const CATEGORY_HEADS = new Set(['nuts', 'seeds', 'spices', 'fish', 'finfish', 'mollusks', 'crustaceans', 'cephalopods']);

interface RawFood {
  fdcId: number;
  description: string;
  category: string | null;
  nutrients: { id: number; amount: number }[];
  portions: { amount: number; modifier: string | null; gramWeight: number }[];
}
interface Food {
  name: string;
  aliases: string[];
  category: string | null;
  per100g: Record<string, number | null>;
  portions: { unit: string; grams: number }[];
}

/** Project a USDA export to compact NDJSON via jq. */
function projectWithJq(path: string, topKey: string): RawFood[] {
  const filter =
    `.${topKey}[] | {fdcId, description, category:(.foodCategory.description // null), ` +
    `nutrients:[(.foodNutrients // [])[]|select(.nutrient.id|IN(${NUTRIENT_IDS}))|{id:.nutrient.id, amount}], ` +
    `portions:[(.foodPortions // [])[]|{amount:(.amount // 1), modifier, gramWeight:(.gramWeight // 0)}]}`;
  const res = spawnSync('jq', ['-c', filter, path], { maxBuffer: 1024 * 1024 * 512, encoding: 'utf8' });
  if (res.status !== 0) throw new Error(`jq failed on ${path}: ${res.stderr?.slice(0, 500)}`);
  return res.stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as RawFood);
}

/** A cooking name from a USDA "Head, qualifier, …" description (USDA inverts). */
function canonicalName(description: string): string {
  const segments = description.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (segments.length === 0) return description.toLowerCase();
  const head = segments[0].replace(/\s+/g, ' ');
  const qualifier = segments.slice(1).find((seg) => {
    if (NAME_STOP_HEAD.test(seg)) return false;
    const words = seg.split(/\s+/);
    return words.length <= 2 && words.every((w) => !NAME_NOISE.has(w));
  });
  if (CATEGORY_HEADS.has(head) && segments[1]) return (qualifier ?? segments[1]).replace(/\s+/g, ' ').trim();
  return (qualifier ? `${qualifier} ${head}` : head).replace(/\s+/g, ' ').trim();
}

/** Extract a normalized portion (cup/tablespoon/teaspoon/count) from a USDA modifier. */
function toPortion(p: { amount: number; modifier: string | null; gramWeight: number }): { unit: string; grams: number } | null {
  const mod = (p.modifier ?? '').toLowerCase();
  const per = p.gramWeight / (p.amount || 1);
  if (!(per > 0)) return null;
  let unit: string | null = null;
  if (/\bcup\b/.test(mod)) unit = 'cup';
  else if (/\btablespoons?\b|\btbsp\b/.test(mod)) unit = 'tablespoon';
  else if (/\bteaspoons?\b|\btsp\b/.test(mod)) unit = 'teaspoon';
  else if (/\b(each|whole|medium|large|small|cloves?|slices?|pieces?|fruits?|leaf|leaves|stalks?|heads?|links?|ears?|units?|servings?|extra large|jumbo)\b/.test(mod)) unit = 'count';
  return unit ? { unit, grams: Math.round(per * 100) / 100 } : null;
}

function labelCore(nutrients: { id: number; amount: number }[]): Record<string, number | null> {
  const per100g: Record<string, number | null> = Object.fromEntries(LABEL_KEYS.map((k) => [k, null]));
  for (const n of nutrients) {
    const key = NUTRIENT_BY_ID[n.id];
    if (key && typeof n.amount === 'number') per100g[key] = n.amount;
  }
  return per100g;
}
function portionList(raw: RawFood): { unit: string; grams: number }[] {
  const out: { unit: string; grams: number }[] = [];
  const seen = new Set<string>();
  for (const p of raw.portions) {
    const m = toPortion(p);
    if (m && !seen.has(m.unit)) { seen.add(m.unit); out.push(m); }
  }
  return out;
}
function nutrientCount(per100g: Record<string, number | null>): number {
  return LABEL_KEYS.reduce((n, k) => n + (per100g[k] != null ? 1 : 0), 0);
}
function keepable(raw: RawFood): boolean {
  return Boolean(raw.category && KEEP_CATEGORIES.has(raw.category) && !BRAND_RE.test(raw.description));
}

interface Entry { name: string; category: string | null; per100g: Record<string, number | null>; portions: Map<string, number>; overlay: boolean; nCount: number; }

/** Merge a raw food into the map keyed by NORMALIZED name (so "onions"/"chopped
 * onions"/"yellow onions" collapse to one), unioning portions and keeping the
 * richest nutrients (Foundation overlay wins, then more nutrients). */
function mergeInto(map: Map<string, Entry>, raw: RawFood, overlay: boolean): void {
  const per100g = labelCore(raw.nutrients);
  if (per100g.calories == null) return;
  const name = canonicalName(raw.description);
  const key = normalizeTokens(name).join(' ');
  if (!key) return;
  const nCount = nutrientCount(per100g);
  const portions = portionList(raw);
  const existing = map.get(key);
  if (!existing) {
    map.set(key, { name, category: raw.category, per100g, portions: new Map(portions.map((p) => [p.unit, p.grams])), overlay, nCount });
    return;
  }
  for (const p of portions) if (!existing.portions.has(p.unit)) existing.portions.set(p.unit, p.grams); // union
  const better = (overlay && !existing.overlay) || (overlay === existing.overlay && nCount > existing.nCount);
  if (better) { existing.name = name; existing.category = raw.category; existing.per100g = per100g; existing.overlay = overlay; existing.nCount = nCount; }
}

// Curated staples: forced cooking name + aliases, sourced from a specific USDA row
// (first raw food whose description matches). Guarantees the top ingredients resolve.
const STAPLES: { name: string; aliases: string[]; match: RegExp }[] = [
  { name: 'salt', aliases: ['table salt', 'kosher salt', 'sea salt', 'fine salt'], match: /^Salt, table/i },
  { name: 'heavy cream', aliases: ['heavy whipping cream', 'whipping cream'], match: /^Cream, fluid, heavy whipping/i },
  { name: 'sour cream', aliases: [], match: /^Cream, sour, cultured/i },
  { name: 'milk', aliases: ['whole milk'], match: /^Milk, whole, 3\.25%/i },
  { name: 'butter', aliases: ['unsalted butter', 'salted butter'], match: /^Butter, without salt/i },
  { name: 'all-purpose flour', aliases: ['flour', 'plain flour', 'white flour', 'wheat flour'], match: /^Wheat flour, white, all-purpose, enriched, bleached/i },
  { name: 'sugar', aliases: ['granulated sugar', 'white sugar', 'caster sugar'], match: /^Sugars, granulated/i },
  { name: 'brown sugar', aliases: ['light brown sugar', 'dark brown sugar'], match: /^Sugars, brown/i },
  { name: 'powdered sugar', aliases: ['confectioners sugar', 'icing sugar'], match: /^Sugars, powdered/i },
  { name: 'olive oil', aliases: ['extra virgin olive oil', 'evoo'], match: /^Oil, olive/i },
  { name: 'vegetable oil', aliases: ['canola oil'], match: /^Oil, canola/i },
  { name: 'egg', aliases: ['eggs', 'large egg', 'whole egg'], match: /^Egg, whole, raw, fresh/i },
  { name: 'chicken breast', aliases: ['chicken breasts', 'chicken'], match: /^Chicken, broilers or fryers, breast, meat and skin, raw/i },
  { name: 'chicken thigh', aliases: ['chicken thighs'], match: /^Chicken, broilers or fryers, thigh, meat and skin, raw/i },
  { name: 'ground beef', aliases: ['minced beef', 'hamburger', 'beef mince'], match: /^Beef, ground, 85% lean meat.*raw/i },
  { name: 'beef', aliases: ['steak', 'beef steak'], match: /^Beef, loin, top sirloin.*raw/i },
  { name: 'pork', aliases: ['pork chop', 'pork loin'], match: /^Pork, fresh, loin, .*chops.*raw/i },
  { name: 'bacon', aliases: [], match: /^Pork, cured, bacon, unprepared/i },
  { name: 'salmon', aliases: [], match: /^Fish, salmon, Atlantic, farmed, raw/i },
  { name: 'shrimp', aliases: ['prawns'], match: /^Crustaceans, shrimp, .*raw/i },
  { name: 'garlic', aliases: ['garlic clove', 'garlic cloves'], match: /^Garlic, raw/i },
  { name: 'onion', aliases: ['onions', 'yellow onion', 'white onion'], match: /^Onions, raw/i },
  { name: 'red onion', aliases: [], match: /^Onions, red, raw/i },
  { name: 'scallion', aliases: ['green onion', 'green onions', 'spring onion'], match: /^Onions, spring or scallions.*raw/i },
  { name: 'tomato', aliases: ['tomatoes'], match: /^Tomatoes, red, ripe, raw, year round average/i },
  { name: 'carrot', aliases: ['carrots'], match: /^Carrots, raw/i },
  { name: 'celery', aliases: [], match: /^Celery, raw/i },
  { name: 'potato', aliases: ['potatoes'], match: /^Potatoes, .*flesh and skin, raw/i },
  { name: 'bell pepper', aliases: ['bell peppers', 'red pepper', 'green pepper', 'sweet pepper'], match: /^Peppers, sweet, red, raw/i },
  { name: 'cucumber', aliases: ['cucumbers'], match: /^Cucumber, with peel, raw/i },
  { name: 'broccoli', aliases: [], match: /^Broccoli, raw/i },
  { name: 'spinach', aliases: [], match: /^Spinach, raw/i },
  { name: 'mushroom', aliases: ['mushrooms'], match: /^Mushrooms, white, raw/i },
  { name: 'lemon', aliases: ['lemons'], match: /^Lemons, raw, without peel/i },
  { name: 'lime', aliases: ['limes'], match: /^Limes, raw/i },
  { name: 'ginger', aliases: [], match: /^Ginger root, raw/i },
  { name: 'cilantro', aliases: ['coriander', 'fresh coriander'], match: /^Coriander \(cilantro\) leaves, raw/i },
  { name: 'basil', aliases: [], match: /^Basil, fresh/i },
  { name: 'rice', aliases: ['white rice', 'long grain rice'], match: /^Rice, white, long-grain, regular, raw, enriched/i },
  { name: 'brown rice', aliases: [], match: /^Rice, brown, long-grain, raw/i },
  { name: 'pasta', aliases: ['spaghetti', 'macaroni', 'penne'], match: /^Pasta, dry, enriched/i },
  { name: 'oats', aliases: ['rolled oats', 'oatmeal', 'porridge oats'], match: /^Oats \(Includes/i },
  { name: 'cheddar cheese', aliases: ['cheddar'], match: /^Cheese, cheddar$/i },
  { name: 'parmesan cheese', aliases: ['parmesan', 'parmigiano', 'parmigiano reggiano'], match: /^Cheese, parmesan, grated$|^Cheese, parmesan, hard/i },
  { name: 'mozzarella cheese', aliases: ['mozzarella'], match: /^Cheese, mozzarella, whole milk$/i },
  { name: 'feta cheese', aliases: ['feta'], match: /^Cheese, feta/i },
  { name: 'cream cheese', aliases: [], match: /^Cheese, cream/i },
  { name: 'chickpeas', aliases: ['chickpea', 'garbanzo', 'garbanzo beans'], match: /^Chickpeas \(garbanzo beans.*mature seeds, raw/i },
  { name: 'black beans', aliases: [], match: /^Beans, black, mature seeds, raw/i },
  { name: 'kidney beans', aliases: [], match: /^Beans, kidney, red, mature seeds, raw/i },
  { name: 'eggplant', aliases: ['aubergine'], match: /^Eggplant, raw/i },
  { name: 'zucchini', aliases: ['courgette'], match: /^Squash, summer, zucchini, includes skin, raw/i },
  { name: 'avocado', aliases: ['avocados'], match: /^Avocados, raw, all commercial varieties/i },
  { name: 'apple', aliases: ['apples'], match: /^Apples, raw, with skin/i },
  { name: 'banana', aliases: ['bananas'], match: /^Bananas, raw/i },
  { name: 'soy sauce', aliases: ['soya sauce'], match: /^Soy sauce made from soy and wheat \(shoyu\)/i },
  { name: 'honey', aliases: [], match: /^Honey$/i },
  { name: 'vanilla extract', aliases: ['vanilla'], match: /^Vanilla extract$/i },
  { name: 'baking soda', aliases: ['sodium bicarbonate'], match: /^Leavening agents, baking soda/i },
  { name: 'baking powder', aliases: [], match: /^Leavening agents, baking powder, double-acting, sodium/i },
  // Pantry liquids/condiments — common in real recipes; pulled from their (excluded)
  // categories via the description match, which searches all raw foods.
  { name: 'chicken broth', aliases: ['broth', 'stock', 'chicken stock', 'vegetable broth', 'vegetable stock', 'beef broth', 'beef stock'], match: /^Soup, chicken broth, canned, condensed/i },
  { name: 'coconut milk', aliases: ['coconut cream', 'full fat coconut milk'], match: /^Nuts, coconut milk, canned/i },
  { name: 'tomato paste', aliases: [], match: /^Tomato products, canned, paste, without salt added/i },
  { name: 'tomato sauce', aliases: ['marinara', 'marinara sauce', 'pasta sauce'], match: /^Tomato products, canned, sauce$/i },
  { name: 'maple syrup', aliases: ['pure maple syrup'], match: /^Syrups, maple/i },
  { name: 'greek yogurt', aliases: ['yogurt', 'plain yogurt'], match: /^Yogurt, Greek, plain, whole milk/i },
  { name: 'black pepper', aliases: ['pepper', 'ground pepper'], match: /^Spices, pepper, black/i },
  { name: 'cinnamon', aliases: [], match: /^Spices, cinnamon, ground/i },
  { name: 'paprika', aliases: [], match: /^Spices, paprika/i },
  { name: 'cumin', aliases: ['ground cumin'], match: /^Spices, cumin seed/i },
  { name: 'oregano', aliases: [], match: /^Spices, oregano, dried/i },
];

// count/cup gram weights for the common countable produce + dry goods, so an
// unqualified "2 onions" / "2 cups flour" always resolves (USDA reference weights).
// A whole-item gram weight per count (USDA reference). These OVERRIDE any USDA
// count portion, because USDA's captured "count" is often a slice/ring, not a
// whole item (e.g. onion "1 slice" = 14 g, not a 110 g whole onion).
const COUNT_GRAMS: [key: string, grams: number][] = [
  ['onion', 110], ['red onion', 110], ['garlic', 3], ['tomato', 123], ['egg', 50], ['bell pepper', 119],
  ['carrot', 61], ['celery', 40], ['potato', 213], ['lemon', 58], ['lime', 67], ['apple', 182],
  ['banana', 118], ['avocado', 150], ['cucumber', 301], ['scallion', 15], ['zucchini', 196],
  ['mushroom', 18], ['jalapeno', 14], ['shallot', 40], ['orange', 131],
  ['chicken breast', 174], ['chicken thigh', 82],
];
const CUP_GRAMS: [RegExp, number][] = [
  [/\bflour\b/, 125], [/\bsugar\b/, 200], [/\brice\b/, 185], [/\boats?\b|\boatmeal\b/, 90],
  [/\bcocoa\b/, 86], [/\bcornmeal\b/, 157],
];
const HAND_FOODS: Food[] = [
  { name: 'water', aliases: [], category: 'Beverages', per100g: Object.fromEntries(LABEL_KEYS.map((k) => [k, 0])), portions: [] },
];

function main(): void {
  const [srPath, foundationPath] = process.argv.slice(2);
  if (!srPath || !foundationPath) {
    console.error('usage: tsx scripts/build-foods-seed.ts <sr_legacy.json> <foundation.json>');
    process.exit(1);
  }

  const srRaw = projectWithJq(srPath, 'SRLegacyFoods');
  const fdRaw = projectWithJq(foundationPath, 'FoundationFoods');

  const map = new Map<string, Entry>();
  for (const raw of srRaw) if (keepable(raw)) mergeInto(map, raw, false);
  for (const raw of fdRaw) if (keepable(raw)) mergeInto(map, raw, true);

  const foods: Food[] = [...map.values()].map((e) => ({
    name: e.name, aliases: [], category: e.category, per100g: e.per100g,
    portions: [...e.portions.entries()].map(([unit, grams]) => ({ unit, grams })),
  }));

  // Curated staples: force name + aliases + portions from a specific USDA row.
  const allRaw = [...fdRaw, ...srRaw]; // Foundation first (preferred on match)
  const byKey = new Map(foods.map((f) => [normalizeTokens(f.name).join(' '), f]));
  for (const staple of STAPLES) {
    const raw = allRaw.find((r) => staple.match.test(r.description) && labelCore(r.nutrients).calories != null);
    if (!raw) { console.warn(`  staple not found: ${staple.name} (${staple.match})`); continue; }
    const key = normalizeTokens(staple.name).join(' ');
    const food: Food = { name: staple.name, aliases: staple.aliases, category: raw.category, per100g: labelCore(raw.nutrients), portions: portionList(raw) };
    byKey.set(key, food);
  }
  const merged = [...byKey.values(), ...HAND_FOODS];

  // Backfill count/cup portions so unqualified counts + dry-good cups resolve.
  const byName = new Map(merged.map((f) => [normalizeTokens(f.name).join(' '), f]));
  for (const [key, grams] of COUNT_GRAMS) {
    const f = byName.get(normalizeTokens(key).join(' '));
    if (f) f.portions = [...f.portions.filter((p) => p.unit !== 'count'), { unit: 'count', grams }]; // override
  }
  for (const f of merged) {
    if (f.portions.some((p) => p.unit === 'cup')) continue;
    const m = CUP_GRAMS.find(([re]) => re.test(f.name));
    if (m) f.portions.push({ unit: 'cup', grams: m[1] });
  }

  merged.sort((a, b) => a.name.localeCompare(b.name));
  const outPath = join(dirname(fileURLToPath(import.meta.url)), '../seed/foods.json');
  writeFileSync(outPath, JSON.stringify(merged));
  console.log(`Wrote ${merged.length} foods → ${outPath}`);
  console.log(`  cup portion: ${merged.filter((f) => f.portions.some((p) => p.unit === 'cup')).length} · count portion: ${merged.filter((f) => f.portions.some((p) => p.unit === 'count')).length}`);
}

main();
