import { fetchWithRetry } from '../parse/http.js';
import { VOCAB } from './vocab.js';
import { TECHNIQUE_NAMES, techniqueWeight } from '../difficulty/technique-difficulty.js';

/**
 * RecipeAnalyzer (WI-TS-2 + WI-DIFF-5) — the ONE OpenAI gpt-5.6-luna call that both
 * classifies a recipe's taste (cuisine / meal type / dish type, the Edamam three-axis
 * model rules handle worst) AND detects each step's cooking techniques, constrained to
 * `TECHNIQUE_NAMES` — riding the same call at ~0 new network cost. (OPENAI_API_KEY seam,
 * JSON mode.) The taste facets are the ONLY source of those three axes; primary_ingredient
 * stays FDC-grounded. `stepTechniques[i]` aligns to `steps[i]` (empty where none / unknown).
 */
export interface TasteFacets {
  cuisine: string[];
  mealType: string[];
  dishType: string[];
}

/** The analyzer's output: the taste facets plus per-step detected techniques. */
export interface RecipeAnalysis extends TasteFacets {
  stepTechniques: string[][];
}

export interface RecipeAnalyzer {
  /**
   * @param title - The recipe title.
   * @param ingredientNames - The recipe's ingredient names.
   * @param steps - The recipe's ordered step texts.
   * @returns VOCAB-constrained facets + `TECHNIQUE_NAMES`-constrained techniques per step
   *   (`stepTechniques[i]` aligned to `steps[i]`, empty when unsure). Never throws on bad output.
   */
  analyze(title: string, ingredientNames: string[], steps: string[]): Promise<RecipeAnalysis>;
}

const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';
// ponytail: mirrors extractor.ts's OpenAI tier; swap the id if renamed.
const LUNA_MODEL = 'gpt-5.6-luna';

function systemPrompt(): string {
  return (
    "Classify the recipe's cuisine, meal type, and dish type. These are independent: " +
    'mealType is WHEN it is eaten (e.g. a french toast is "breakfast"); dishType is the ' +
    "dish's FORM (e.g. that french toast is a \"pancake\" or \"bread\"). " +
    'Also, for each step, list the cooking techniques it uses. ' +
    'Return JSON {"cuisine": string[], "mealType": string[], "dishType": string[], "stepTechniques": string[][]}. ' +
    `Use ONLY these cuisine values: ${VOCAB.cuisine.join(', ')}. ` +
    `Use ONLY these mealType values: ${VOCAB.mealType.join(', ')}. ` +
    `Use ONLY these dishType values: ${VOCAB.dishType.join(', ')}. ` +
    'Return at most two of each; use an empty array for a facet you are not confident about. ' +
    `For each step, list the cooking techniques it uses, using ONLY these technique names: ${TECHNIQUE_NAMES.join(', ')}. ` +
    'Return stepTechniques as an array aligned to the steps, each an array of technique names (empty if none).'
  );
}

/** Live analyzer over the OpenAI chat seam. */
export class LunaRecipeAnalyzer implements RecipeAnalyzer {
  constructor(private readonly apiKey: string) {}

  static create(): LunaRecipeAnalyzer {
    return new LunaRecipeAnalyzer(process.env.OPENAI_API_KEY!);
  }

  async analyze(title: string, ingredientNames: string[], steps: string[]): Promise<RecipeAnalysis> {
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
    if (!res.ok) throw new Error(`Luna recipe analysis failed — HTTP ${res.status}`);
    const json = (await res.json()) as { choices: Array<{ message: { content: string } }> };
    return constrain(json.choices[0]?.message.content, steps.length);
  }
}

/** Offline double: returns nothing, deterministically. Selected when no key is set. */
export class StubRecipeAnalyzer implements RecipeAnalyzer {
  async analyze(): Promise<RecipeAnalysis> {
    return { cuisine: [], mealType: [], dishType: [], stepTechniques: [] };
  }
}

/** Parses the model's JSON content, keeping only VOCAB facet members and only
 * `TECHNIQUE_NAMES` step techniques (unknowns dropped), aligned to `stepCount`. Never throws. */
function constrain(content: string | undefined, stepCount: number): RecipeAnalysis {
  try {
    const parsed = JSON.parse(content ?? '{}') as {
      cuisine?: unknown;
      mealType?: unknown;
      dishType?: unknown;
      stepTechniques?: unknown;
    };
    return {
      cuisine: pick(parsed.cuisine, VOCAB.cuisine),
      mealType: pick(parsed.mealType, VOCAB.mealType),
      dishType: pick(parsed.dishType, VOCAB.dishType),
      stepTechniques: pickTechniques(parsed.stepTechniques, stepCount),
    };
  } catch {
    return { cuisine: [], mealType: [], dishType: [], stepTechniques: [] };
  }
}

function pick(value: unknown, vocab: readonly string[]): string[] {
  if (!Array.isArray(value)) return [];
  const allowed = new Set(vocab);
  return value.filter((v): v is string => typeof v === 'string' && allowed.has(v));
}

/** Per-step technique arrays, each filtered to known `TECHNIQUE_NAMES`, aligned to
 * `stepCount` (missing rows → empty) so the result stays index-aligned to the steps. */
function pickTechniques(value: unknown, stepCount: number): string[][] {
  const rows = Array.isArray(value) ? value : [];
  return Array.from({ length: stepCount }, (_, i) => {
    const row = rows[i];
    if (!Array.isArray(row)) return [];
    return row.filter((t): t is string => typeof t === 'string' && techniqueWeight(t) != null);
  });
}

/** The analyzer for the current env: Luna when a key is present, else the stub. */
export function selectRecipeAnalyzer(): RecipeAnalyzer {
  return process.env.OPENAI_API_KEY ? LunaRecipeAnalyzer.create() : new StubRecipeAnalyzer();
}
