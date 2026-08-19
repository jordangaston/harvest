import { fetchWithRetry } from '../parse/http.js';
import type { Equipment, Essentiality } from '../schema.js';
import { EQUIPMENT_NAMES, defaultEssentiality, type DetectedEquipment, type DetectedItem } from './equipment.js';
import { EquipmentMatcher } from './equipment-matcher.js';

/**
 * EquipmentDetector (WI-EQ-2) — LLM-primary equipment detection with the deterministic
 * `EquipmentMatcher` as the degradation fallback. A dedicated detector (its own focused
 * prompt, its own pipeline step — EQUIPMENT-SIGNAL.md Q-E4), NOT folded into the categorizer.
 * The LLM reads title + ingredients + steps and judges implicit gear AND per-recipe
 * essentiality; the detector constrains its output to the `EQUIPMENT_NAMES` vocab (like the
 * categorizer re-validating the taste analyzer). On any LLM failure — or with no key
 * configured — the matcher's explicit-mention scan is the floor and `complete = false`,
 * keeping the ranking filter lenient.
 */

/** The analyzer's RAW (LLM-shaped) output; the detector constrains it to the vocab. */
export interface EquipmentAnalysis {
  equipment: { type: string; essentiality?: string }[];
  stepEquipment: string[][];
}

/** The LLM seam (OpenAI, JSON mode), like the taste analyzer. */
export interface EquipmentAnalyzer {
  analyze(title: string, ingredientNames: string[], steps: string[]): Promise<EquipmentAnalysis>;
}

const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';
// ponytail: mirrors taste-classifier.ts's OpenAI tier; swap the id if renamed.
const LUNA_MODEL = 'gpt-5.6-luna';

export class EquipmentDetector {
  constructor(
    private readonly matcher: EquipmentMatcher,
    private readonly analyzer: EquipmentAnalyzer | null,
  ) {}

  /** Wire the real detector: the pure matcher + the env-selected LLM analyzer (null offline). */
  static create(): EquipmentDetector {
    return new EquipmentDetector(EquipmentMatcher.create(), selectEquipmentAnalyzer());
  }

  /**
   * Detects a recipe's equipment. The LLM is primary; on its failure (or with no analyzer
   * configured) the deterministic matcher runs and `complete` is false.
   * @returns The recipe-level set (per-recipe essentiality), the per-step alignment (aligned
   *   to `steps`), and completeness. Off-vocab types are dropped; a bad essentiality falls
   *   back to the type's `defaultEssentiality`.
   */
  async detect(title: string, ingredientNames: string[], steps: string[]): Promise<DetectedEquipment> {
    if (this.analyzer) {
      try {
        const raw = await this.analyzer.analyze(title, ingredientNames, steps);
        return { ...constrain(raw, steps.length), complete: true };
      } catch {
        // fall through to the deterministic floor
      }
    }
    return { ...this.matcher.detect(steps), complete: false };
  }
}

function systemPrompt(): string {
  return (
    'Identify the notable kitchen equipment a recipe needs — special appliances only, never ' +
    'baseline gear (oven, stovetop, microwave, pots, pans, knives, bowls, baking sheets). ' +
    'Detect implicit gear from context (a title "Air Fryer Wings", "beat to stiff peaks" ⇒ a mixer). ' +
    'For each item judge essentiality FOR THIS RECIPE: "required" when no workable substitute exists ' +
    '(the appliance IS the method), "recommended" when a common substitute works. ' +
    `Use ONLY these equipment values: ${EQUIPMENT_NAMES.join(', ')}. ` +
    'Return JSON {"equipment": {"type": string, "essentiality": "required"|"recommended"}[], ' +
    '"stepEquipment": string[][]} where stepEquipment is aligned to the steps (each an array of ' +
    'equipment values used in that step, empty if none). Omit anything not in the list.'
  );
}

/** Live analyzer over the OpenAI chat seam. Returns the raw parsed shape (best-effort); the
 * detector constrains it to the vocab. */
export class LunaEquipmentAnalyzer implements EquipmentAnalyzer {
  constructor(private readonly apiKey: string) {}

  static create(): LunaEquipmentAnalyzer {
    return new LunaEquipmentAnalyzer(process.env.OPENAI_API_KEY!);
  }

  async analyze(title: string, ingredientNames: string[], steps: string[]): Promise<EquipmentAnalysis> {
    const res = await fetchWithRetry(OPENAI_CHAT_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: LUNA_MODEL,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt() },
          {
            role: 'user',
            content:
              `Title: ${title}\nIngredients: ${ingredientNames.join(', ')}\n` +
              `Steps:\n${steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`,
          },
        ],
      }),
    });
    if (!res.ok) throw new Error(`Luna equipment detection failed — HTTP ${res.status}`);
    const json = (await res.json()) as { choices: Array<{ message: { content: string } }> };
    return parse(json.choices[0]?.message.content);
  }
}

/** Best-effort JSON parse of the model content into the raw analysis shape; a bad body → empty
 * (the detector then degrades to the matcher). Vocab-constraining is the detector's job. */
function parse(content: string | undefined): EquipmentAnalysis {
  try {
    const p = JSON.parse(content ?? '{}') as EquipmentAnalysis;
    return { equipment: Array.isArray(p.equipment) ? p.equipment : [], stepEquipment: Array.isArray(p.stepEquipment) ? p.stepEquipment : [] };
  } catch {
    return { equipment: [], stepEquipment: [] };
  }
}

/** Constrains a raw analysis to the vocab: keep known types (dedup, first wins), coerce a bad
 * essentiality to the type's `defaultEssentiality`, filter each step row to known types, and
 * align `stepEquipment` to `stepCount`. */
function constrain(raw: EquipmentAnalysis, stepCount: number): { equipment: DetectedItem[]; stepEquipment: Equipment[][] } {
  const allowed = new Set<string>(EQUIPMENT_NAMES);
  const seen = new Map<Equipment, Essentiality>();
  for (const item of raw.equipment ?? []) {
    const type = item?.type;
    if (typeof type !== 'string' || !allowed.has(type) || seen.has(type as Equipment)) continue;
    const e = item.essentiality;
    seen.set(type as Equipment, e === 'required' || e === 'recommended' ? e : defaultEssentiality(type as Equipment));
  }
  const stepEquipment = Array.from({ length: stepCount }, (_, i) => {
    const row = raw.stepEquipment?.[i];
    if (!Array.isArray(row)) return [];
    return [...new Set(row.filter((t): t is Equipment => typeof t === 'string' && allowed.has(t)))];
  });
  return { equipment: [...seen].map(([equipment, essentiality]) => ({ equipment, essentiality })), stepEquipment };
}

/** The analyzer for the current env: Luna when a key is present, else null (matcher floor). */
export function selectEquipmentAnalyzer(): EquipmentAnalyzer | null {
  return process.env.OPENAI_API_KEY ? LunaEquipmentAnalyzer.create() : null;
}
