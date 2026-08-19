import type { Equipment } from '../schema.js';
import { EQUIPMENT, defaultEssentiality, type DetectedItem } from './equipment.js';

/**
 * EquipmentMatcher (WI-EQ-2) — the deterministic degradation fallback: a per-step alias
 * scan that catches EXPLICIT equipment mentions when the LLM detector fails or is absent.
 * The same high-precision `\b`-anchored gazetteer mechanism as `TechniqueMatcher`: every
 * `EQUIPMENT` alias is compiled ONCE (longest form first) into a case-insensitive,
 * diacritic/hyphen-folded alternation mapped to its canonical `Equipment`. Recall is the
 * floor here, not the ceiling — implicit gear and substitutability are the LLM's job.
 */
export class EquipmentMatcher {
  private constructor(
    private readonly regex: RegExp,
    private readonly canonicalByForm: Map<string, Equipment>,
  ) {}

  /** Builds the matcher, compiling the regex from the shared `EQUIPMENT` config once. */
  static create(): EquipmentMatcher {
    return new EquipmentMatcher(...compile());
  }

  /**
   * Scans each step for explicit equipment mentions.
   * @param steps - The recipe's ordered step texts.
   * @returns The per-step equipment (index-aligned to `steps`) and the recipe-level roll-up
   *   (the union), each carrying its config `defaultEssentiality` prior.
   */
  detect(steps: string[]): { stepEquipment: Equipment[][]; equipment: DetectedItem[] } {
    const stepEquipment = steps.map((step) => this.matchStep(step));
    const union = new Set<Equipment>(stepEquipment.flat());
    const equipment = [...union].map((e) => ({ equipment: e, essentiality: defaultEssentiality(e) }));
    return { stepEquipment, equipment };
  }

  /** The distinct equipment named in one step (order-preserving, deduped). */
  private matchStep(step: string): Equipment[] {
    const text = normalize(step);
    const found = new Set<Equipment>();
    for (const match of text.matchAll(this.regex)) {
      const canonical = this.canonicalByForm.get(match[0]);
      if (canonical) found.add(canonical);
    }
    return [...found];
  }
}

/** Lowercase, strip diacritics, replace hyphens with spaces, collapse whitespace — so
 * `air-fryer`/`air fryer`/`Air  Fryer` and `sous-vide`/`sous vide` fold to one form. Folding
 * diacritics is required so JS's ASCII `\b` still fires around the term (same rationale as
 * `TechniqueMatcher.normalize`). */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Compiles the `EQUIPMENT` aliases into a `\b`-anchored alternation (longest form first,
 * so a multi-word alias wins over a prefix) plus a normalized-form → canonical lookup. */
function compile(): [RegExp, Map<string, Equipment>] {
  const canonicalByForm = new Map<string, Equipment>();
  for (const { canonical, aliases } of EQUIPMENT) {
    for (const alias of aliases) canonicalByForm.set(normalize(alias), canonical);
  }
  const alternation = [...canonicalByForm.keys()]
    .sort((a, b) => b.length - a.length)
    .map(escape)
    .join('|');
  return [new RegExp(`\\b(?:${alternation})\\b`, 'gi'), canonicalByForm];
}

/** Escapes regex metacharacters in an alias form (aliases are plain words, but be safe). */
function escape(form: string): string {
  return form.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
