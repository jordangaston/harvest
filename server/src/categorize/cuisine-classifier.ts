import { fetchWithRetry } from '../parse/http.js';

/**
 * CuisineClassifier (WI-TS-2, tier 3) — the LLM fallback for cuisine, the facet
 * rules handle worst. Reuses the extractor's existing OpenAI seam (gpt-5.6-luna,
 * OPENAI_API_KEY, JSON mode) rather than adding a provider. Only invoked when tiers
 * 1–2 leave cuisine empty. Output is constrained to the caller's vocabulary.
 */
export interface CuisineClassifier {
  /** @returns a subset of `vocab` (empty if none). Never throws on bad output. */
  classify(title: string, ingredientNames: string[], vocab: readonly string[]): Promise<string[]>;
}

// ponytail: mirrors server/src/parse/extractor.ts's OpenAI tier; swap the id if renamed.
const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';
const LUNA_MODEL = 'gpt-5.6-luna';

function systemPrompt(vocab: readonly string[]): string {
  return (
    'Classify the recipe\'s cuisine(s). Return JSON {"cuisine": string[]}. ' +
    `Use ONLY these values: ${vocab.join(', ')}. ` +
    'Return at most two, and an empty array if you are not confident.'
  );
}

/** Live classifier over the OpenAI chat seam. */
export class LunaCuisineClassifier implements CuisineClassifier {
  constructor(private readonly apiKey: string) {}

  static create(): LunaCuisineClassifier {
    return new LunaCuisineClassifier(process.env.OPENAI_API_KEY!);
  }

  async classify(title: string, ingredientNames: string[], vocab: readonly string[]): Promise<string[]> {
    const res = await fetchWithRetry(OPENAI_CHAT_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: LUNA_MODEL,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt(vocab) },
          { role: 'user', content: `Title: ${title}\nIngredients: ${ingredientNames.join(', ')}` },
        ],
      }),
    });
    if (!res.ok) throw new Error(`Luna cuisine classification failed — HTTP ${res.status}`);
    const json = (await res.json()) as { choices: Array<{ message: { content: string } }> };
    return constrain(json.choices[0]?.message.content, vocab);
  }
}

/** Offline double: returns nothing, deterministically. Selected when no key is set. */
export class StubCuisineClassifier implements CuisineClassifier {
  async classify(): Promise<string[]> {
    return [];
  }
}

/** Parses the model's JSON content and keeps only VOCAB members; never throws. */
function constrain(content: string | undefined, vocab: readonly string[]): string[] {
  try {
    const parsed = JSON.parse(content ?? '{}') as { cuisine?: unknown };
    if (!Array.isArray(parsed.cuisine)) return [];
    const allowed = new Set(vocab);
    return parsed.cuisine.filter((v): v is string => typeof v === 'string' && allowed.has(v));
  } catch {
    return [];
  }
}

/** The classifier for the current env: Luna when a key is present, else the stub. */
export function selectCuisineClassifier(): CuisineClassifier {
  return process.env.OPENAI_API_KEY ? LunaCuisineClassifier.create() : new StubCuisineClassifier();
}
