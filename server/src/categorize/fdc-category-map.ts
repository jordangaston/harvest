/**
 * FdcCategoryMap (WI-TS-2, tier 1) — maps an FDC food group to a `primary_ingredient`
 * VOCAB value, or null for non-ingredient groups (fats, sauces, sweets, beverages).
 *
 * The catalog's `category` is the WWEIA food-category description (e.g. "Fish",
 * "Poultry", "Vegetables, dark green"), which is granular (~170 values). So we match
 * by keyword over the description rather than an exact lookup — robust to the full
 * seed and to the simplified test fixture alike. First matching rule wins; order
 * matters (pasta before grain). Values are all `VOCAB.primaryIngredient` members.
 *
 * Q-02: validate coverage against the real seeded catalog before launch.
 */
const RULES: { re: RegExp; value: string }[] = [
  { re: /shrimp|prawn|scallop|clam|oyster|mussel|crab|lobster|shellfish|fish|salmon|tuna|cod|seafood/, value: 'seafood' },
  { re: /poultry|chicken|turkey|duck/, value: 'poultry' },
  { re: /\bpork\b|bacon|ham|sausage/, value: 'pork' },
  { re: /\bbeef\b|steak|veal/, value: 'beef' },
  { re: /lamb|mutton|goat/, value: 'lamb' },
  { re: /\beggs?\b/, value: 'egg' },
  { re: /cheese/, value: 'cheese' },
  { re: /tofu|soy/, value: 'tofu' },
  { re: /bean|legume|lentil|chickpea/, value: 'beans' },
  { re: /pasta|noodle/, value: 'pasta' },
  { re: /grain|rice|bread|cereal|\boat|wheat|flour|tortilla/, value: 'grain' },
  { re: /vegetable/, value: 'vegetable' },
];

/**
 * @param fdcGroup - the WWEIA food-category description from `fdc_foods.category`.
 * @returns a `primary_ingredient` VOCAB value, or null when the group is not a
 *   primary ingredient (fats, milk, sweets, snacks, sauces, fruit, beverages).
 */
export function toPrimaryIngredient(fdcGroup: string | null): string | null {
  if (!fdcGroup) return null;
  const g = fdcGroup.toLowerCase();
  for (const { re, value } of RULES) if (re.test(g)) return value;
  return null;
}
