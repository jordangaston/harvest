/**
 * FoodClassMap (WI-DS-1) — the diet-relevant class of an ingredient. Two sources,
 * name first: an ingredient NAME carries the most reliable signal ("bacon", "cheddar")
 * and, crucially, catches foods whose WWEIA category hides their diet class — butter,
 * cream, and ghee all sit in "Fats and oils", not a dairy category. The FDC CATEGORY is
 * the recall fallback for names without a keyword ("romaine" → "Vegetables" → vegetable).
 *
 * This is the `toPrimaryIngredient` sibling: same keyword-rule approach, but coarser and
 * diet-complete (it must resolve dairy/egg/legume, which the primary-ingredient map drops).
 * Order matters — a plant qualifier must beat a dairy word so "peanut butter" and "almond
 * milk" never read as dairy.
 * ponytail: curated heuristic with a known ceiling — plant-milk/nut-butter edge cases are
 * handled by rule order, not exhaustively; extend the guards as misses surface.
 */

export const FOOD_CLASSES = [
  'red_meat', 'poultry', 'seafood', 'dairy', 'egg',
  'grain', 'legume', 'vegetable', 'fruit', 'nuts_seeds', 'fat_oil', 'sweets',
] as const;

export type FoodClass = (typeof FOOD_CLASSES)[number];

/** Whole-word, case-insensitive test of `word` (may contain spaces) in `text`, tolerating a
 * regular plural (`clam` matches `clams`) — otherwise plural seafood/meat names slip the diet rules. */
function has(text: string, word: string): boolean {
  return new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\b`, 'i').test(text);
}

function hasAny(text: string, words: string[]): boolean {
  return words.some((w) => has(text, w));
}

// A plant qualifier that must dominate a following dairy word ("almond milk", "peanut
// butter", "coconut cream", "cocoa butter" are all plant-based).
const PLANT_QUALIFIER = ['peanut', 'almond', 'cashew', 'coconut', 'soy', 'oat', 'rice', 'hemp', 'nut', 'cocoa', 'apple', 'shea', 'sunflower', 'seed'];

/**
 * The class implied by an ingredient's name, or null when no high-precision keyword hits.
 * Meat/poultry/seafood by name are robust; the dairy block guards milk/cream/butter so a
 * plant-qualified name falls through to null (then the category, or nothing, decides).
 */
export function foodClassFromName(name: string): FoodClass | null {
  const n = name.toLowerCase();
  if (hasAny(n, ['bacon', 'ham', 'prosciutto', 'salami', 'pepperoni', 'chorizo', 'sausage', 'beef', 'steak', 'pork', 'lamb', 'veal', 'venison', 'bison', 'meatball'])) return 'red_meat';
  if (hasAny(n, ['chicken', 'turkey', 'duck', 'goose'])) return 'poultry';
  if (hasAny(n, ['salmon', 'tuna', 'cod', 'shrimp', 'prawn', 'crab', 'lobster', 'clam', 'oyster', 'mussel', 'scallop', 'anchovy', 'anchovies', 'sardine', 'tilapia', 'halibut', 'trout', 'fish'])) return 'seafood';
  if (hasAny(n, ['egg', 'eggs'])) return 'egg';
  if (hasAny(n, ['cheese', 'cheddar', 'parmesan', 'mozzarella', 'paneer', 'feta', 'ricotta', 'yogurt', 'yoghurt', 'buttermilk', 'ghee'])) return 'dairy';
  const plantQualified = hasAny(n, PLANT_QUALIFIER);
  if (!plantQualified && hasAny(n, ['milk', 'cream', 'butter'])) return 'dairy';
  return null;
}

// Keyword-over-WWEIA-description rules; first match wins. Dairy before fat so a real dairy
// category isn't shadowed; seafood/poultry before red_meat for the shared "cured" wording.
const CATEGORY_RULES: { re: RegExp; cls: FoodClass }[] = [
  { re: /shrimp|prawn|scallop|clam|oyster|mussel|crab|lobster|shellfish|\bfish\b|salmon|tuna|seafood|anchov/, cls: 'seafood' },
  { re: /poultry|chicken|turkey|duck/, cls: 'poultry' },
  { re: /beef|\bpork\b|lamb|veal|goat|game|bacon|\bham\b|sausage|frankfurter|cured meat|lunch meat|organ meat|\bmeat\b/, cls: 'red_meat' },
  { re: /\begg/, cls: 'egg' },
  { re: /milk|cheese|yogurt|yoghurt|cream|dairy|custard|ice cream|whey/, cls: 'dairy' },
  { re: /bean|\bpea\b|peas|legume|lentil|chickpea|\bsoy|tofu/, cls: 'legume' },
  { re: /\bnut|seed|almond|peanut/, cls: 'nuts_seeds' },
  { re: /rice|pasta|bread|cereal|grain|\boat|wheat|flour|tortilla|noodle|cracker/, cls: 'grain' },
  { re: /fruit|apple|banana|berr|citrus|melon|grape|peach|pear|mango/, cls: 'fruit' },
  { re: /vegetable|tomato|lettuce|potato|carrot|onion|greens|broccoli|pepper|squash|mushroom/, cls: 'vegetable' },
  { re: /fats and oils|\boil\b|margarine|shortening/, cls: 'fat_oil' },
  { re: /sugar|honey|cand|sweet|syrup|dessert|\bjam\b|chocolate/, cls: 'sweets' },
];

/** The class implied by a food's WWEIA category description, or null for an unclassified group. */
export function foodClassFromCategory(category: string | null): FoodClass | null {
  if (!category) return null;
  const c = category.toLowerCase();
  for (const { re, cls } of CATEGORY_RULES) if (re.test(c)) return cls;
  return null;
}
