// Serving-scale math + quantity display for grocery items.

const FRACTIONS: Record<number, string> = { 0.25: "¼", 0.5: "½", 0.75: "¾" };

/**
 * Scales an amount by a servings ratio, rounded to the nearest ¼ (the granularity
 * groceries are bought in). A null amount (freeform "a pinch") passes through.
 */
export function scaleAmount(amount: number | null, ratio: number): number | null {
  if (amount == null) return null;
  const scaled = Math.round(amount * ratio * 4) / 4;
  return scaled;
}

/** Formats a number with a nice fraction: 1.5 → "1½", 0.25 → "¼", 2 → "2". */
export function formatNumber(n: number): string {
  const whole = Math.floor(n);
  const frac = Math.round((n - whole) * 100) / 100;
  const glyph = FRACTIONS[frac];
  if (glyph) return whole > 0 ? `${whole}${glyph}` : glyph;
  return String(Math.round(n * 100) / 100);
}

/** Rough pluralize for display: cup → cups when the amount isn't 1. */
function pluralizeUnit(unit: string, amount: number): string {
  if (amount === 1 || unit.endsWith("s")) return unit;
  return `${unit}s`;
}

/**
 * The display quantity for an item. Prefers a freeform `quantityText`; otherwise
 * formats amount + unit ("2 cups", "1½ pound", "12" for a countless `count`).
 */
export function formatQuantity(
  amount: number | null,
  unit: string | null,
  quantityText?: string | null,
): string {
  if (quantityText) return quantityText;
  if (amount == null) return "";
  if (!unit || unit === "count") return formatNumber(amount);
  return `${formatNumber(amount)} ${pluralizeUnit(unit, amount)}`;
}
