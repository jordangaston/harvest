/**
 * TECHNIQUE_DIFFICULTY (WI-DIFF-2, O-DIFF-01) — the curated cooking-technique lexicon:
 * each entry is a canonical technique, its weight (1–5), and the lowercase surface
 * forms (inflections + synonyms) that signal it. A code constant, not a table — small
 * and versioned with the code, matching the VOCAB precedent in `../categorize/vocab.ts`.
 *
 * Weight scale: 1 trivial (combine, boil) · 2 basic knife/pan work (chop, sauté) ·
 * 3 heat control / timing (sear, deglaze, reduce) · 4 transformation with a failure
 * mode (emulsify, caramelize, proof) · 5 precision technique (temper, laminate, confit).
 *
 * ponytail (Q-01): this is a defensible PROVISIONAL list — it needs a cooking-literate
 * tuning pass on both membership and weights. Adding a form is a one-line, no-migration
 * change; recall is the calibration lever.
 */
export interface TechniqueEntry {
  canonical: string;
  weight: 1 | 2 | 3 | 4 | 5;
  forms: string[];
}

export const TECHNIQUE_DIFFICULTY: TechniqueEntry[] = [
  // ── 5: precision technique ──────────────────────────────────────────────────
  { canonical: 'temper', weight: 5, forms: ['temper', 'tempered', 'tempering'] },
  { canonical: 'laminate', weight: 5, forms: ['laminate', 'laminated', 'laminating', 'lamination'] },
  { canonical: 'bain-marie', weight: 5, forms: ['bain-marie', 'bain marie', 'water bath', 'double boiler'] },
  { canonical: 'confit', weight: 5, forms: ['confit'] },
  { canonical: 'sous-vide', weight: 5, forms: ['sous vide'] },
  { canonical: 'clarify-butter', weight: 5, forms: ['clarified butter', 'ghee', 'beurre noisette'] },
  // ── 4: transformation with a failure mode ───────────────────────────────────
  { canonical: 'emulsify', weight: 4, forms: ['emulsify', 'emulsified', 'emulsifying', 'emulsion'] },
  { canonical: 'caramelize', weight: 4, forms: ['caramelize', 'caramelise', 'caramelized', 'caramelised', 'caramelizing', 'caramelising'] },
  { canonical: 'proof', weight: 4, forms: ['proof', 'proofed', 'proofing', 'prove', 'proved', 'proving'] },
  { canonical: 'clarify', weight: 4, forms: ['clarify', 'clarified', 'clarifying'] },
  { canonical: 'blanch-and-shock', weight: 4, forms: ['blanch and shock', 'ice bath', 'shock in ice'] },
  { canonical: 'flambe', weight: 4, forms: ['flambe', 'flambé', 'flambeed', 'flambéed'] },
  { canonical: 'candy', weight: 4, forms: ['candy', 'candied', 'candying'] },
  // ── 3: heat control / timing ────────────────────────────────────────────────
  { canonical: 'sear', weight: 3, forms: ['sear', 'seared', 'searing'] },
  { canonical: 'deglaze', weight: 3, forms: ['deglaze', 'deglazed', 'deglazing'] },
  { canonical: 'reduce', weight: 3, forms: ['reduce', 'reduced', 'reducing', 'reduction'] },
  { canonical: 'braise', weight: 3, forms: ['braise', 'braised', 'braising'] },
  { canonical: 'poach', weight: 3, forms: ['poach', 'poached', 'poaching'] },
  { canonical: 'fold', weight: 3, forms: ['fold', 'folded', 'folding'] },
  { canonical: 'blanch', weight: 3, forms: ['blanch', 'blanched', 'blanching'] },
  { canonical: 'render', weight: 3, forms: ['render', 'rendered', 'rendering'] },
  { canonical: 'roux', weight: 3, forms: ['roux'] },
  { canonical: 'temper-eggs', weight: 3, forms: ['temper the eggs'] },
  { canonical: 'whip', weight: 3, forms: ['whip', 'whipped', 'whipping'] },
  { canonical: 'steep', weight: 3, forms: ['steep', 'steeped', 'steeping', 'infuse', 'infused', 'infusing'] },
  // ── 2: basic knife / pan work ───────────────────────────────────────────────
  { canonical: 'saute', weight: 2, forms: ['sauté', 'saute', 'sautéed', 'sauteed', 'sautéing', 'sauteing'] },
  { canonical: 'chop', weight: 2, forms: ['chop', 'chopped', 'chopping'] },
  { canonical: 'dice', weight: 2, forms: ['dice', 'diced', 'dicing'] },
  { canonical: 'mince', weight: 2, forms: ['mince', 'minced', 'mincing'] },
  { canonical: 'whisk', weight: 2, forms: ['whisk', 'whisked', 'whisking'] },
  { canonical: 'knead', weight: 2, forms: ['knead', 'kneaded', 'kneading'] },
  { canonical: 'fry', weight: 2, forms: ['fry', 'fried', 'frying', 'pan-fry', 'pan fry', 'deep-fry', 'deep fry', 'stir-fry', 'stir fry'] },
  { canonical: 'roast', weight: 2, forms: ['roast', 'roasted', 'roasting'] },
  { canonical: 'grill', weight: 2, forms: ['grill', 'grilled', 'grilling'] },
  { canonical: 'julienne', weight: 2, forms: ['julienne', 'julienned'] },
  { canonical: 'zest', weight: 2, forms: ['zest', 'zested', 'zesting'] },
  { canonical: 'marinate', weight: 2, forms: ['marinate', 'marinated', 'marinating'] },
  { canonical: 'baste', weight: 2, forms: ['baste', 'basted', 'basting'] },
  { canonical: 'steam', weight: 2, forms: ['steam', 'steamed', 'steaming'] },
  { canonical: 'grate', weight: 2, forms: ['grate', 'grated', 'grating'] },
  // ── 1: trivial ──────────────────────────────────────────────────────────────
  { canonical: 'boil', weight: 1, forms: ['boil', 'boiled', 'boiling'] },
  { canonical: 'simmer', weight: 1, forms: ['simmer', 'simmered', 'simmering'] },
  { canonical: 'toss', weight: 1, forms: ['toss', 'tossed', 'tossing'] },
  { canonical: 'combine', weight: 1, forms: ['combine', 'combined', 'combining'] },
  { canonical: 'mix', weight: 1, forms: ['mix', 'mixed', 'mixing'] },
  { canonical: 'stir', weight: 1, forms: ['stir', 'stirred', 'stirring'] },
  { canonical: 'season', weight: 1, forms: ['season', 'seasoned', 'seasoning'] },
  { canonical: 'serve', weight: 1, forms: ['serve', 'served', 'serving'] },
  { canonical: 'bake', weight: 1, forms: ['bake', 'baked', 'baking'] },
  { canonical: 'warm', weight: 1, forms: ['warm', 'warmed', 'warming'] },
  { canonical: 'drain', weight: 1, forms: ['drain', 'drained', 'draining'] },
  { canonical: 'garnish', weight: 1, forms: ['garnish', 'garnished', 'garnishing'] },
  { canonical: 'spread', weight: 1, forms: ['spread', 'spreading'] },
  { canonical: 'pour', weight: 1, forms: ['pour', 'poured', 'pouring'] },
  { canonical: 'sprinkle', weight: 1, forms: ['sprinkle', 'sprinkled', 'sprinkling'] },
  { canonical: 'layer', weight: 1, forms: ['layer', 'layered', 'layering'] },
];

/** The canonical technique names (WI-DIFF-5) — the LLM's allowed vocabulary and the
 * validation set for constraining its per-step detections, like `VOCAB` for taste. */
export const TECHNIQUE_NAMES: string[] = TECHNIQUE_DIFFICULTY.map((e) => e.canonical);

const WEIGHT_BY_NAME = new Map(TECHNIQUE_DIFFICULTY.map((e) => [e.canonical, e.weight]));

/** The weight (1–5) for a canonical technique name, or undefined if not in the table. */
export function techniqueWeight(name: string): number | undefined {
  return WEIGHT_BY_NAME.get(name);
}

/**
 * DIFFICULTY_CONFIG (WI-DIFF-2, O-DIFF-02/03) — the normalization caps and band cutoffs.
 * ponytail (Q-02): PROVISIONAL cold-start values. STEP_CAP/ING_CAP/TIME_CAP are the
 * "common sense" caps; C50/C85 are placeholder cutoffs pending the first corpus
 * percentile computation. Tunable in code with no migration.
 */
export const DIFFICULTY_CONFIG = {
  STEP_CAP: 15,
  ING_CAP: 20,
  TIME_CAP: 120,
  C50: 38,
  C85: 66,
} as const;
