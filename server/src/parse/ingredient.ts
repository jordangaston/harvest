/**
 * C3: split a raw ingredient line into a structured measurement so recipes can be
 * scaled. Deterministic (no LLM). Parses the common case (leading amount + optional
 * known unit + name). A "plus"/"+" secondary measure is COMBINED into the total,
 * expressed in the smaller of the two units ("1 tbsp, plus 1 tsp vanilla" → 4 teaspoon
 * vanilla); an unmeasured aside ("3 tbsp butter, plus more for the pan") keeps the
 * leading measure. Cross-system amounts (volume + mass) can't combine → the leading
 * measure stands. Anything with no leading number, or a "to taste", stays unparsed
 * (`amount`/`unit` null, whole line as `name`) — honest over wrong.
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

/** Within-system unit ratios for combining a "plus" secondary measure. Volume in
 * teaspoons (US customary, exact integer ratios); mass in grams. Kept local to avoid a
 * parse→nutrition import cycle; ratios agree with quantity-converter where they overlap. */
const UNIT_FACTOR: Record<string, { system: 'volume' | 'mass'; per: number }> = {
  teaspoon: { system: 'volume', per: 1 },
  tablespoon: { system: 'volume', per: 3 },
  cup: { system: 'volume', per: 48 },
  milliliter: { system: 'volume', per: 0.202884 },
  liter: { system: 'volume', per: 202.884 },
  gram: { system: 'mass', per: 1 },
  kilogram: { system: 'mass', per: 1000 },
  ounce: { system: 'mass', per: 28.3495 },
  pound: { system: 'mass', per: 453.592 },
};

/** Shapes with no scalable leading amount we refuse to parse. A numeric range collapses
 * to its lower bound below; "plus"/"+" is combined (see `combine`), not refused. */
const AMBIGUOUS = /\bto taste\b/i;

/** A leading range ("2-3", "4 - 6", "1 to 2") → keep only the lower bound. */
const LEADING_RANGE = /^(\d+(?:\.\d+)?|\d+\/\d+)(?:\s*[-–—]\s*|\s+to\s+)\d+(?:\.\d+)?/i;

/** A leading amount: mixed "1 1/2", fraction "1/2", unicode "½", or decimal "2.5". */
const LEADING_AMOUNT = /^(\d+\s+\d+\/\d+|\d+\/\d+|[¼½¾⅓⅔⅛⅜⅝⅞]|\d+(?:\.\d+)?)/;

/** A parsed leading amount + optional unit, with the text that follows it. */
interface Measure {
  amount: number;
  unit: string | null;
  rest: string;
}

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

/** Take a leading amount (+ optional known unit) off the front of `s`, or null. */
function takeMeasure(s: string): Measure | null {
  const m = LEADING_AMOUNT.exec(s);
  if (!m) return null;
  const amount = parseAmount(m[0]);
  if (amount == null) return null;
  let rest = s.slice(m[0].length).trim();
  let unit: string | null = null;
  const um = /^([a-zA-Z]+)\.?\b/.exec(rest);
  if (um) {
    const canonical = UNIT_ALIASES[um[1].toLowerCase()];
    if (canonical) {
      unit = canonical;
      rest = rest.slice(um[0].length).trim();
    }
  }
  return { amount, unit, rest };
}

/** Sum two same-system measures, expressed in the smaller unit. Different systems, or an
 * unknown/absent unit on either side → keep the leading measure (no cross-system algebra). */
function combine(a: { amount: number; unit: string | null }, b: Measure): { amount: number; unit: string | null } {
  const fa = a.unit ? UNIT_FACTOR[a.unit] : undefined;
  const fb = b.unit ? UNIT_FACTOR[b.unit] : undefined;
  if (!fa || !fb || fa.system !== fb.system) return { amount: a.amount, unit: a.unit };
  const base = a.amount * fa.per + b.amount * fb.per;
  const smaller = fa.per <= fb.per ? { unit: a.unit, per: fa.per } : { unit: b.unit, per: fb.per };
  return { amount: base / smaller.per, unit: smaller.unit };
}

/**
 * Structure one raw ingredient line. Never throws; never drops the line.
 * @param raw - The verbatim ingredient line.
 * @returns The structured ingredient; `quantityText` is always the raw line.
 */
export function parseIngredientLine(raw: string): StructuredIngredient {
  const quantityText = raw;
  // Collapse a leading numeric range to its lower bound ("2-3 cups" → "2 cups").
  const line = raw.trim().replace(/\s+/g, ' ').replace(LEADING_RANGE, '$1');
  const unparsed: StructuredIngredient = { name: line, amount: null, unit: null, quantityText };

  if (AMBIGUOUS.test(line)) return unparsed;
  const lead = takeMeasure(line);
  if (!lead) return unparsed;

  let amount = lead.amount;
  let unit = lead.unit;
  // Drop a leading "of" ("2 cups of flour" → flour); keep the rest as the name.
  let name = lead.rest.replace(/^of\s+/i, '').trim();

  // A "plus"/"+" secondary measure: "N u X, plus more…" (name before) or "N u, plus M u2
  // X" (name after). A measured second amount is combined; an unmeasured aside is dropped.
  const plus = /,?\s*(?:\bplus\b|\+)\s*/i.exec(name);
  if (plus) {
    const before = name.slice(0, plus.index).trim();
    const second = takeMeasure(name.slice(plus.index + plus[0].length).trim());
    if (second) {
      ({ amount, unit } = combine({ amount, unit }, second));
      name = (before || second.rest.replace(/^of\s+/i, '')).trim();
    } else {
      name = before || name; // unmeasured aside ("plus more…") → keep the leading measure
    }
  }

  return { name: name || line, amount: toAmountString(amount), unit, quantityText };
}
