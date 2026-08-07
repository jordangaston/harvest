/**
 * Ingredient → icon-key mapping (O-09). Pure and deterministic. The keys mirror
 * the mobile app's painterly icon set (components/recime/recipes.ts), so a
 * persisted icon resolves to a real asset there. First keyword hit wins; unknown
 * ingredients fall back to `default`.
 */

/** Keyword → icon-key. Order matters: earlier, more specific keys win. Keys must
 * exist in the app's ICON map (components/recime/recipes.ts); unmatched → `default`
 * → the branded Harvest-H fallback. */
const KEYWORDS: Array<[RegExp, string]> = [
  // Oils (before generic matches)
  [/olive oil/, 'oliveOil'],
  [/sesame oil/, 'sesameOil'],
  // Stocks (specific beef stock before generic stock/broth)
  [/beef stock|beef broth/, 'beefStock'],
  [/\bstock\b|\bbroth\b/, 'stock'],
  // Proteins (bacon before pork; salmon/fish; shrimp; cheese)
  [/bacon|pancetta/, 'bacon'],
  [/\bpork\b|\bham\b|sausage|chorizo/, 'pork'],
  [/\bbeef\b|brisket|steak|ground beef/, 'beef'],
  [/chicken/, 'chicken'],
  [/salmon|\bfish\b|\bcod\b|tilapia|tuna|haddock/, 'fish'],
  [/shrimp|prawn/, 'shrimp'],
  [/parmesan|mozzarella|cheddar|\bfeta\b|\bcheese\b/, 'cheese'],
  [/\begg/, 'egg'],
  // Produce (scallion before onion; bell pepper before pepper; salt before pepper)
  [/scallion|green onion|spring onion/, 'scallion'],
  [/carrot/, 'carrot'],
  [/\bonion|shallot/, 'onion'],
  [/garlic/, 'garlic'],
  [/ginger/, 'ginger'],
  [/bell pepper|capsicum/, 'bellPepper'],
  [/mushroom/, 'mushroom'],
  [/broccoli/, 'broccoli'],
  [/spinach/, 'spinach'],
  [/potato/, 'potato'],
  [/tomato paste/, 'tomatoPaste'],
  [/tomato/, 'tomato'],
  [/\blime\b/, 'lime'],
  [/lemon/, 'lemon'],
  [/chil(?:i|li|e)|jalapeno|red pepper flake/, 'chili'],
  [/banana/, 'banana'],
  // Seasoning (salt before pepper so "salt and pepper" resolves to salt)
  [/\bsalt\b/, 'salt'],
  [/pepper/, 'pepper'],
  [/paprika/, 'paprika'],
  [/cumin/, 'cumin'],
  [/oregano/, 'oregano'],
  [/thyme/, 'thyme'],
  [/basil/, 'basil'],
  [/parsley|cilantro|coriander/, 'parsley'],
  [/cinnamon/, 'cinnamon'],
  [/vanilla/, 'vanilla'],
  // Pantry / dairy / liquids
  [/soy sauce|\bsoy\b/, 'soySauce'],
  [/mustard/, 'mustard'],
  [/red wine|merlot|pinot/, 'redWine'],
  [/bouillon/, 'bouillon'],
  [/cornstarch|corn starch|cornflour/, 'cornstarch'],
  [/flour/, 'flour'],
  [/brown sugar/, 'brownSugar'],
  [/\bsugar\b/, 'sugar'],
  [/honey/, 'honey'],
  [/butter/, 'butter'],
  [/heavy cream|sour cream|\bcream\b/, 'cream'],
  [/\bmilk\b/, 'milk'],
  [/\brice\b/, 'rice'],
  [/pasta|spaghetti|noodle|penne|macaroni|linguine/, 'pasta'],
  [/baking soda/, 'bakingSoda'],
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
