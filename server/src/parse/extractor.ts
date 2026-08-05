import { env } from '../config/env.js';
import { groqFetch } from './groq.js';
import type { ExtractedRecipe } from '../fetch/website.js';

/**
 * Recipe extraction (O-06): turn caption/transcript/vision text into a structured
 * recipe (JSON) with a confidence score. The Groq path prompts Qwen; the stub
 * derives a deterministic recipe from the caption so tests run offline.
 */

const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';
// A non-reasoning model with JSON mode — a reasoning model (Qwen3) breaks
// `response_format: json_object` on long captions (empty json_validate_failed).
// ponytail: swap the id if Groq renames it.
const EXTRACTION_MODEL = 'llama-3.3-70b-versatile';

/** The signals an extractor reads. `structured` is a JSON-LD shortcut. */
export interface ParseContext {
  caption?: string;
  transcript?: string;
  visionText?: string;
  structured?: ExtractedRecipe;
}

/** ExtractedRecipe + a 0–1 confidence the caller uses to gate persistence. */
export interface ExtractedRecipeData extends ExtractedRecipe {
  confidence: number;
}

export interface RecipeExtractor {
  extract(ctx: ParseContext): Promise<ExtractedRecipeData>;
}

const SYSTEM_PROMPT =
  'Extract a recipe as JSON with keys: title (string), ingredients (string[]), ' +
  'steps (string[]), servings (string, optional), totalMinutes (number, optional), ' +
  'imageUrl (string, optional), confidence (number 0-1). Use only the given text; ' +
  'set confidence low when the text is thin or ambiguous.';

/** Flattens a ParseContext into one prompt string for the LLM. */
function contextText(ctx: ParseContext): string {
  return [
    ctx.caption && `Caption:\n${ctx.caption}`,
    ctx.transcript && `Transcript:\n${ctx.transcript}`,
    ctx.visionText && `On-screen text:\n${ctx.visionText}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** Coerces a parsed LLM object into ExtractedRecipeData, defaulting confidence. */
function toData(raw: Record<string, unknown>): ExtractedRecipeData {
  return {
    title: typeof raw.title === 'string' ? raw.title : '',
    ingredients: Array.isArray(raw.ingredients) ? (raw.ingredients as string[]) : [],
    steps: Array.isArray(raw.steps) ? (raw.steps as string[]) : [],
    servings: typeof raw.servings === 'string' ? raw.servings : undefined,
    totalMinutes: typeof raw.totalMinutes === 'number' ? raw.totalMinutes : undefined,
    // Empty string → absent, so a thumbnail fallback (`?? thumbnail`) applies.
    imageUrl: typeof raw.imageUrl === 'string' && raw.imageUrl ? raw.imageUrl : undefined,
    confidence: typeof raw.confidence === 'number' ? raw.confidence : 0.5,
  };
}

/** Qwen JSON extraction via Groq. */
export class GroqExtractor implements RecipeExtractor {
  /** @param apiKey - Groq API key for Bearer auth. */
  constructor(private readonly apiKey: string) {}

  /** Wire the singleton env key. */
  static create(): GroqExtractor {
    return new GroqExtractor(env.GROQ_API_KEY!);
  }

  /**
   * @param ctx - The parse signals to extract from.
   * @returns The structured recipe with a confidence score.
   * @throws Error - On a non-2xx Groq response.
   */
  async extract(ctx: ParseContext): Promise<ExtractedRecipeData> {
    const res = await groqFetch(GROQ_CHAT_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: EXTRACTION_MODEL,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: contextText(ctx) },
        ],
      }),
    });
    if (!res.ok) throw new Error(`Groq extraction failed — HTTP ${res.status}`);
    const json = (await res.json()) as { choices: Array<{ message: { content: string } }> };
    return toData(JSON.parse(json.choices[0]?.message.content ?? '{}'));
  }
}

/** Dev/test double: derives a recipe from the caption's first line, no network. */
export class StubExtractor implements RecipeExtractor {
  /**
   * @param ctx - Read for a caption/vision/transcript first line.
   * @returns A deterministic single-ingredient recipe (empty title → confidence 0).
   */
  async extract(ctx: ParseContext): Promise<ExtractedRecipeData> {
    const text = ctx.caption ?? ctx.visionText ?? ctx.transcript ?? '';
    const [firstLine] = text.split('\n');
    const title = (firstLine ?? '').replace(/[—-].*$/, '').trim();
    return {
      title,
      ingredients: title ? ['1 serving of ' + title] : [],
      steps: ['Prepare ' + title],
      confidence: title ? 0.9 : 0,
    };
  }
}

/** Groq if keyed, else the offline stub. */
export function selectExtractor(): RecipeExtractor {
  return env.GROQ_API_KEY ? GroqExtractor.create() : new StubExtractor();
}
