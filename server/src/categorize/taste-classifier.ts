import { fetchWithRetry } from '../parse/http.js';
import { VOCAB } from './vocab.js';

/**
 * TasteClassifier (WI-TS-2) — the LLM that assigns a recipe's cuisine, meal type, and
 * dish type (the Edamam three-axis taste model), the facets rules handle worst. One
 * OpenAI gpt-5.6-luna call (the extractor's seam, OPENAI_API_KEY, JSON mode), constrained
 * to VOCAB. The ONLY source of these three facets — primary_ingredient stays FDC-grounded.
 */
export interface TasteFacets {
  cuisine: string[];
  mealType: string[];
  dishType: string[];
}

export interface TasteClassifier {
  /** @returns VOCAB subsets for each facet (empty when unsure). Never throws on bad output. */
  classify(title: string, ingredientNames: string[]): Promise<TasteFacets>;
}

const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';
// ponytail: mirrors extractor.ts's OpenAI tier; swap the id if renamed.
const LUNA_MODEL = 'gpt-5.6-luna';

function systemPrompt(): string {
  return (
    "Classify the recipe's cuisine, meal type, and dish type. These are independent: " +
    'mealType is WHEN it is eaten (e.g. a french toast is "breakfast"); dishType is the ' +
    "dish's FORM (e.g. that french toast is a \"pancake\" or \"bread\"). " +
    'Return JSON {"cuisine": string[], "mealType": string[], "dishType": string[]}. ' +
    `Use ONLY these cuisine values: ${VOCAB.cuisine.join(', ')}. ` +
    `Use ONLY these mealType values: ${VOCAB.mealType.join(', ')}. ` +
    `Use ONLY these dishType values: ${VOCAB.dishType.join(', ')}. ` +
    'Return at most two of each; use an empty array for a facet you are not confident about.'
  );
}

/** Live classifier over the OpenAI chat seam. */
export class LunaTasteClassifier implements TasteClassifier {
  constructor(private readonly apiKey: string) {}

  static create(): LunaTasteClassifier {
    return new LunaTasteClassifier(process.env.OPENAI_API_KEY!);
  }

  async classify(title: string, ingredientNames: string[]): Promise<TasteFacets> {
    const res = await fetchWithRetry(OPENAI_CHAT_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: LUNA_MODEL,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt() },
          { role: 'user', content: `Title: ${title}\nIngredients: ${ingredientNames.join(', ')}` },
        ],
      }),
    });
    if (!res.ok) throw new Error(`Luna taste classification failed — HTTP ${res.status}`);
    const json = (await res.json()) as { choices: Array<{ message: { content: string } }> };
    return constrain(json.choices[0]?.message.content);
  }
}

/** Offline double: returns nothing, deterministically. Selected when no key is set. */
export class StubTasteClassifier implements TasteClassifier {
  async classify(): Promise<TasteFacets> {
    return { cuisine: [], mealType: [], dishType: [] };
  }
}

/** Parses the model's JSON content and keeps only VOCAB members per facet; never throws. */
function constrain(content: string | undefined): TasteFacets {
  try {
    const parsed = JSON.parse(content ?? '{}') as { cuisine?: unknown; mealType?: unknown; dishType?: unknown };
    return {
      cuisine: pick(parsed.cuisine, VOCAB.cuisine),
      mealType: pick(parsed.mealType, VOCAB.mealType),
      dishType: pick(parsed.dishType, VOCAB.dishType),
    };
  } catch {
    return { cuisine: [], mealType: [], dishType: [] };
  }
}

function pick(value: unknown, vocab: readonly string[]): string[] {
  if (!Array.isArray(value)) return [];
  const allowed = new Set(vocab);
  return value.filter((v): v is string => typeof v === 'string' && allowed.has(v));
}

/** The classifier for the current env: Luna when a key is present, else the stub. */
export function selectTasteClassifier(): TasteClassifier {
  return process.env.OPENAI_API_KEY ? LunaTasteClassifier.create() : new StubTasteClassifier();
}
