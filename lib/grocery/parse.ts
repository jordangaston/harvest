// Todoist-style parse of a manually-typed grocery line: peel a leading quantity and
// (optional) unit off the front, leave the rest as the ingredient name. Returns the
// structured fields to send AND highlight tokens so the add field can colour what it
// read as quantity/unit vs. the ingredient keyword as the user types.

export type TokenKind = "qty" | "unit" | "name";
export interface ParsedToken {
  text: string;
  kind: TokenKind;
}
export interface ParsedLine {
  amount: number | null;
  unit: string | null; // canonical, singular
  name: string;
  tokens: ParsedToken[];
}

/** Alias → canonical singular unit. Only these lead words are read as a unit. */
const UNIT_ALIASES: Record<string, string> = {
  cup: "cup", cups: "cup",
  tbsp: "tablespoon", tbsps: "tablespoon", tbs: "tablespoon", tablespoon: "tablespoon", tablespoons: "tablespoon",
  tsp: "teaspoon", tsps: "teaspoon", teaspoon: "teaspoon", teaspoons: "teaspoon",
  oz: "ounce", ounce: "ounce", ounces: "ounce",
  lb: "pound", lbs: "pound", pound: "pound", pounds: "pound",
  g: "gram", gram: "gram", grams: "gram",
  kg: "kilogram", kilogram: "kilogram", kilograms: "kilogram",
  ml: "milliliter", milliliter: "milliliter", milliliters: "milliliter",
  l: "liter", liter: "liter", liters: "liter", litre: "liter",
  clove: "clove", cloves: "clove",
  can: "can", cans: "can",
  package: "package", packages: "package", pkg: "package", pack: "package",
  bunch: "bunch", bunches: "bunch",
  pinch: "pinch", pinches: "pinch",
  slice: "slice", slices: "slice",
  stick: "stick", sticks: "stick",
  head: "head", heads: "head",
  bag: "bag", bags: "bag",
  box: "box", boxes: "box",
  jar: "jar", jars: "jar",
  bottle: "bottle", bottles: "bottle",
  dozen: "dozen",
};

// Leading quantity: "1 1/2" (mixed), "1/2" (fraction), or "2" / "1.5" (decimal).
const QTY_RE = /^(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?)/;

function toNumber(qty: string): number {
  const mixed = qty.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const frac = qty.match(/^(\d+)\/(\d+)$/);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  return Number(qty);
}

/**
 * Parses a manual grocery line into { amount, unit, name } plus highlight tokens.
 * With no leading number the whole string is the name (amount/unit null).
 */
export function parseGroceryLine(input: string): ParsedLine {
  const text = input.trim();
  const tokens: ParsedToken[] = [];

  const qtyMatch = text.match(QTY_RE);
  if (!qtyMatch) return { amount: null, unit: null, name: text, tokens: text ? [{ text, kind: "name" }] : [] };

  const qtyRaw = qtyMatch[1]!;
  tokens.push({ text: qtyRaw, kind: "qty" });
  let rest = text.slice(qtyRaw.length).trim();

  let unit: string | null = null;
  const wordMatch = rest.match(/^(\S+)/);
  if (wordMatch) {
    const canonical = UNIT_ALIASES[wordMatch[1]!.toLowerCase()];
    if (canonical) {
      unit = canonical;
      tokens.push({ text: wordMatch[1]!, kind: "unit" });
      rest = rest.slice(wordMatch[1]!.length).trim();
    }
  }

  if (rest) tokens.push({ text: rest, kind: "name" });
  return { amount: toNumber(qtyRaw), unit, name: rest, tokens };
}
