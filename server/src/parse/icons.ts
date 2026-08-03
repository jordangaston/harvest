/**
 * Ingredient → icon-key mapping (O-09). Pure and deterministic. The keys mirror
 * the mobile app's painterly icon set (components/recime/recipes.ts), so a
 * persisted icon resolves to a real asset there. First keyword hit wins; unknown
 * ingredients fall back to `default`.
 */

/** Keyword → icon-key. Order matters: earlier, more specific keys win. */
const KEYWORDS: Array<[RegExp, string]> = [
  [/olive oil/, 'oliveOil'],
  [/bacon|pancetta/, 'bacon'],
  [/beef stock|beef broth/, 'beefStock'],
  [/\bbeef\b|brisket|steak|ground beef/, 'beef'],
  [/carrot/, 'carrot'],
  [/\bonion|shallot/, 'onion'],
  [/garlic/, 'garlic'],
  [/pepper/, 'pepper'],
  [/\bsalt\b/, 'salt'],
  [/flour/, 'flour'],
  [/red wine|merlot|pinot/, 'redWine'],
  [/tomato paste/, 'tomatoPaste'],
  [/bouillon/, 'bouillon'],
  [/thyme/, 'thyme'],
  [/banana/, 'banana'],
  [/brown sugar/, 'brownSugar'],
  [/butter/, 'butter'],
  [/\begg/, 'egg'],
  [/baking soda/, 'bakingSoda'],
  [/cinnamon/, 'cinnamon'],
  [/vanilla/, 'vanilla'],
  [/walnut/, 'walnuts'],
];

/**
 * Map an ingredient line to a painterly icon key.
 *
 * @param name - The ingredient text (any casing; may include quantity).
 * @returns The matching icon key, or `default` when nothing matches.
 */
export function mapIngredientIcon(name: string): string {
  const lower = name.toLowerCase();
  const hit = KEYWORDS.find(([re]) => re.test(lower));
  return hit ? hit[1] : 'default';
}
