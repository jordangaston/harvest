import { TECHNIQUE_DIFFICULTY, type TechniqueEntry } from './technique-difficulty.js';

/**
 * TechniqueMatcher (WI-DIFF-2, O-DIFF-01) — the per-step technique scanner. Compiles
 * every `TECHNIQUE_DIFFICULTY` form ONCE into a single case-insensitive, `\b`-anchored
 * alternation regex (longest form first, so "water bath" wins over any prefix), each
 * form mapped to its technique weight. A step's weight is the MAX matched weight, or the
 * baseline 1 when nothing matches. The same high-precision gazetteer mechanism the
 * categorizer's RuleTagger uses.
 */
export class TechniqueMatcher {
  private constructor(
    private readonly regex: RegExp,
    private readonly weightByForm: Map<string, number>,
  ) {}

  /** Builds the matcher, compiling the regex from the shared lexicon once. */
  static create(): TechniqueMatcher {
    return new TechniqueMatcher(...compile(TECHNIQUE_DIFFICULTY));
  }

  /**
   * The per-step technique weights, index-aligned to `steps`.
   * @param steps - The recipe's ordered step texts.
   * @returns One weight (1–5) per step: the hardest technique named in the step, or 1.
   */
  stepWeights(steps: string[]): number[] {
    return steps.map((step) => this.weight(step));
  }

  /** The hardest technique weight named in one step, or the baseline 1. */
  private weight(step: string): number {
    const text = normalize(step);
    let max = 1;
    for (const match of text.matchAll(this.regex)) {
      const weight = this.weightByForm.get(match[0]);
      if (weight != null && weight > max) max = weight;
    }
    return max;
  }
}

/** Lowercase, strip diacritics, replace hyphens with spaces, collapse whitespace — so
 * `sous-vide`/`sous vide`/`Sous  Vide` and `sauté`/`saute` all fold to one form. Folding
 * diacritics is required: JS's ASCII `\b` boundary won't match around a non-ASCII char
 * (`\bsauté\b` never fires), so accented techniques would be silently missed otherwise. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Compiles the lexicon into a `\b`-anchored alternation (longest form first) plus a
 * normalized-form → weight lookup. Forms are normalized so the regex matches the same
 * normalized step text. */
function compile(entries: TechniqueEntry[]): [RegExp, Map<string, number>] {
  const weightByForm = new Map<string, number>();
  for (const { weight, forms } of entries) {
    for (const form of forms) weightByForm.set(normalize(form), weight);
  }
  const alternation = [...weightByForm.keys()]
    .sort((a, b) => b.length - a.length)
    .map(escape)
    .join('|');
  return [new RegExp(`\\b(?:${alternation})\\b`, 'gi'), weightByForm];
}

/** Escapes regex metacharacters in a form (the forms are plain words, but be safe). */
function escape(form: string): string {
  return form.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
