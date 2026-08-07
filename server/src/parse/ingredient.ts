/**
 * C3: split a raw ingredient line into a structured measurement so recipes can be
 * scaled. Deliberately MINIMAL and deterministic — it parses the common case
 * (leading amount + optional known unit + name) and, on anything ambiguous (a
 * range, a "plus" clause, no leading number), leaves `amount`/`unit` null and
 * keeps the whole line as `name`. An unscalable line is honest; a wrongly-combined
 * one is a bug (Architect S4). No unit-algebra, no LLM.
 */

/** One ingredient, measurement separated from the display line. `amount` is a
 * string to match the pg `numeric` convention (like `PublicRecipe.amount`). */
export interface StructuredIngredient {
  name: string;
  amount: string | null;
  unit: string | null;
  quantityText: string;
}

/** Unicode vulgar fractions → decimal. */
const UNICODE_FRACTIONS: Record<string, number> = {
  '¼': 0.25,
  '½': 0.5,
  '¾': 0.75,
  '⅓': 1 / 3,
  '⅔': 2 / 3,
  '⅛': 0.125,
  '⅜': 0.375,
  '⅝': 0.625,
  '⅞': 0.875,
};

/** Known measurement units → lowercase singular canonical. Bare single letters are
 * excluded (too ambiguous against ingredient words); multi-char abbrevs are safe. */
const UNIT_ALIASES: Record<string, string> = {
  teaspoon: 'teaspoon', teaspoons: 'teaspoon', tsp: 'teaspoon',
  tablespoon: 'tablespoon', tablespoons: 'tablespoon', tbsp: 'tablespoon', tbs: 'tablespoon',
  cup: 'cup', cups: 'cup',
  ounce: 'ounce', ounces: 'ounce', oz: 'ounce',
  pound: 'pound', pounds: 'pound', lb: 'pound', lbs: 'pound',
  gram: 'gram', grams: 'gram', g: 'gram',
  kilogram: 'kilogram', kilograms: 'kilogram', kg: 'kilogram',
  milliliter: 'milliliter', milliliters: 'milliliter', ml: 'milliliter',
  liter: 'liter', liters: 'liter', litre: 'liter', litres: 'liter',
};

/** Ambiguous shapes we refuse to parse (would need unit-algebra to combine). */
const AMBIGUOUS = /\bplus\b|\+|\d\s*[-–—]\s*\d|\bto\b\s+\d/i;

/** A leading amount: mixed "1 1/2", fraction "1/2", unicode "½", or decimal "2.5". */
const LEADING_AMOUNT = /^(\d+\s+\d+\/\d+|\d+\/\d+|[¼½¾⅓⅔⅛⅜⅝⅞]|\d+(?:\.\d+)?)/;

/** Parse the leading amount token to a number, or null. */
function parseAmount(token: string): number | null {
  if (UNICODE_FRACTIONS[token] != null) return UNICODE_FRACTIONS[token];
  const mixed = /^(\d+)\s+(\d+)\/(\d+)$/.exec(token);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const frac = /^(\d+)\/(\d+)$/.exec(token);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  const n = Number(token);
  return Number.isFinite(n) ? n : null;
}

/** Round a parsed amount to at most 3 decimals and stringify (drops trailing zeros). */
function toAmountString(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}

/**
 * Structure one raw ingredient line. Never throws; never drops the line.
 * @param raw - The verbatim ingredient line.
 * @returns The structured ingredient; `quantityText` is always the raw line.
 */
export function parseIngredientLine(raw: string): StructuredIngredient {
  const quantityText = raw;
  const line = raw.trim().replace(/\s+/g, ' ');
  const unparsed: StructuredIngredient = { name: line, amount: null, unit: null, quantityText };

  if (AMBIGUOUS.test(line)) return unparsed;
  const amountMatch = LEADING_AMOUNT.exec(line);
  if (!amountMatch) return unparsed;
  const amountValue = parseAmount(amountMatch[0]);
  if (amountValue == null) return unparsed;

  let rest = line.slice(amountMatch[0].length).trim();
  let unit: string | null = null;
  const unitMatch = /^([a-zA-Z]+)\.?\b/.exec(rest);
  if (unitMatch) {
    const canonical = UNIT_ALIASES[unitMatch[1].toLowerCase()];
    if (canonical) {
      unit = canonical;
      rest = rest.slice(unitMatch[0].length).trim();
    }
  }
  // Drop a leading "of" ("2 cups of flour" → flour); keep the rest as the name.
  rest = rest.replace(/^of\s+/i, '').trim();
  return { name: rest || line, amount: toAmountString(amountValue), unit, quantityText };
}
