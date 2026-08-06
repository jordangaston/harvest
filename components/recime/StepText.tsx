import React from "react";
import { Text } from "../ui";
import type { ApiIngredient } from "../../lib/api/types";

// Tokens to strip from the front (quantity/unit/descriptor) and back (prep) of an
// ingredient line to derive a term that actually appears in a step sentence.
const LEAD =
  /^(\d+([/.]\d+)?|½|¼|¾|⅓|⅔|cups?|tbsp|tablespoons?|tsp|teaspoons?|lb|lbs|pounds?|oz|ounces?|g|grams?|kg|ml|l|cloves?|pinch(es)?|cans?|large|small|medium|ripe|fresh|whole|extra-virgin|extra|virgin|of|a|an|the)$/i;
const TRAIL =
  /^(minced|diced|chopped|sliced|divided|optional|crushed|beaten|melted|mashed|softened|trimmed|finely|roughly|to|taste|and)$/i;

/** Reduces an ingredient line to candidate match terms, longest first. */
function matchTerms(name: string): string[] {
  const toks = name
    .toLowerCase()
    .replace(/[(),.]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  while (toks.length && LEAD.test(toks[0])) toks.shift();
  while (toks.length && TRAIL.test(toks[toks.length - 1])) toks.pop();
  const core = toks.join(" ");
  const candidates = [core, toks.slice(-2).join(" "), toks.slice(-1).join(" ")];
  return [...new Set(candidates.filter((c) => c.length >= 3))].sort((a, b) => b.length - a.length);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export type Segment = { text: string; ingredient?: ApiIngredient };

/**
 * Splits a step into plain and tappable segments, tagging the longest ingredient
 * term found at each position. Pure — exported so the matching is verifiable.
 */
export function buildSegments(step: string, ingredients: ApiIngredient[]): Segment[] {
  const terms: { term: string; ingredient: ApiIngredient }[] = [];
  for (const ing of ingredients) {
    for (const term of matchTerms(ing.name)) terms.push({ term, ingredient: ing });
  }
  if (terms.length === 0) return [{ text: step }];
  // Longest terms first so "chicken thighs" wins over "chicken".
  terms.sort((a, b) => b.term.length - a.term.length);
  const pattern = new RegExp(`\\b(${terms.map((t) => escapeRegExp(t.term)).join("|")})\\b`, "gi");

  const segments: Segment[] = [];
  let last = 0;
  for (let m = pattern.exec(step); m; m = pattern.exec(step)) {
    if (m.index > last) segments.push({ text: step.slice(last, m.index) });
    const hit = terms.find((t) => t.term === m![0].toLowerCase());
    segments.push({ text: m[0], ingredient: hit?.ingredient });
    last = m.index + m[0].length;
  }
  if (last < step.length) segments.push({ text: step.slice(last) });
  return segments;
}

/**
 * Renders a step with its ingredient names as tappable, highlighted links.
 * @param onSelect - Called with the tapped ingredient (parent shows the amount + fires haptic).
 */
export function StepText({
  step,
  ingredients,
  onSelect,
}: {
  step: string;
  ingredients: ApiIngredient[];
  onSelect: (ingredient: ApiIngredient) => void;
}) {
  const segments = React.useMemo(() => buildSegments(step, ingredients), [step, ingredients]);
  return (
    <Text className="flex-1 text-base text-ink">
      {segments.map((seg, i) =>
        seg.ingredient ? (
          <Text key={i} onPress={() => onSelect(seg.ingredient!)} className="font-bold text-brand-dark underline">
            {seg.text}
          </Text>
        ) : (
          <Text key={i} className="text-ink">
            {seg.text}
          </Text>
        ),
      )}
    </Text>
  );
}
