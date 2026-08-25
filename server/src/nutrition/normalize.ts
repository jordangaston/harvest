/**
 * The single chokepoint that turns a food name — from a recipe ingredient line or an
 * FNDDS description — into comparable tokens. WI-2's matcher and the seed script both
 * call this so recipe keys and catalog keys line up. Lowercases, drops parenthetical
 * segments, strips prep/descriptor words, singularizes, and tokenizes.
 *
 * @param name - a raw food name (e.g. "Flour, wheat, all-purpose, sifted").
 * @returns lowercase content tokens; never empty for a genuine food name (if the
 *          descriptor strip would empty it, the pre-strip tokens are kept).
 */
export function normalize(name: string): string[] {
  const cleaned = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // fold diacritics: jalapeño→jalapeno, Kahlúa→kahlua
    .replace(/\([^)]*\)/g, ' ') // drop parentheticals
    .replace(/[^a-z0-9\s]/g, ' '); // punctuation → space (commas, hyphens, …)

  const words = cleaned.split(/\s+/).filter(Boolean).map(singularize);
  const kept = words.filter((w) => !DESCRIPTOR_WORDS.has(w));
  return kept.length > 0 ? kept : words;
}

/** Naive English singularizer: enough for food names, not a linguistics engine. */
function singularize(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith('ies')) return word.slice(0, -3) + 'y'; // berries → berry
  if (word.endsWith('ses') || word.endsWith('xes') || word.endsWith('ches') || word.endsWith('shes'))
    return word.slice(0, -2); // tomatoes handled below; dishes → dish
  if (word.endsWith('oes')) return word.slice(0, -2); // tomatoes → tomato, potatoes → potato
  if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1); // eggs → egg
  return word;
}

/** Prep/descriptor words dropped from tokens (they add noise, not identity). Applied
 * after singularization, so store singular forms. "to taste" enters as two tokens. */
const DESCRIPTOR_WORDS = new Set([
  'sifted',
  'chopped',
  'diced',
  'minced',
  'sliced',
  'grated',
  'shredded',
  'crushed',
  'ground',
  'peeled',
  'trimmed',
  'drained',
  'rinsed',
  'melted',
  'softened',
  'beaten',
  'cooked',
  'raw',
  'fresh',
  'frozen',
  'dried',
  'canned',
  'packed',
  'unsalted',
  'salted',
  'to',
  'taste',
  'optional',
  'divided',
  'plus',
  'more',
  'large',
  'medium',
  'small',
  'ripe',
  'whole',
  'halved',
  'quartered',
  'cubed',
]);
