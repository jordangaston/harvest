import { env } from '../config/env.js';
import type { ExtractedRecipe } from '../fetch/website.js';

/**
 * Recipe extraction (O-06): turn caption/transcript/vision text (or already-
 * structured JSON-LD) into a structured recipe with a confidence score. The Groq
 * path prompts Qwen for JSON and escalates to Claude when confidence < 0.6; the
 * stub derives a deterministic recipe from the caption so tests run offline.
 */

const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';
// ponytail: Qwen text model on Groq at build time; swap the id if renamed.
const QWEN_MODEL = 'qwen/qwen3-32b';
const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL = 'claude-opus-4-8';
const ESCALATION_THRESHOLD = 0.6;

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
    imageUrl: typeof raw.imageUrl === 'string' ? raw.imageUrl : undefined,
    confidence: typeof raw.confidence === 'number' ? raw.confidence : 0.5,
  };
}

// Claude escalation for low-confidence Groq extractions (O-06). Not
// network-verified offline; coded to the Anthropic Messages API docs.
export class AnthropicExtractor implements RecipeExtractor {
  constructor(private readonly apiKey: string) {}

  async extract(ctx: ParseContext): Promise<ExtractedRecipeData> {
    const res = await fetch(ANTHROPIC_MESSAGES_URL, {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: contextText(ctx) }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic extraction failed — HTTP ${res.status}`);
    const json = (await res.json()) as { content: Array<{ text?: string }> };
    return toData(JSON.parse(json.content[0]?.text ?? '{}'));
  }
}

// Qwen JSON extraction via Groq; escalates to Claude when it is unsure.
export class GroqExtractor implements RecipeExtractor {
  constructor(
    private readonly apiKey: string,
    private readonly escalation?: RecipeExtractor,
  ) {}

  static create(): GroqExtractor {
    const escalation = env.ANTHROPIC_API_KEY ? new AnthropicExtractor(env.ANTHROPIC_API_KEY) : undefined;
    return new GroqExtractor(env.GROQ_API_KEY!, escalation);
  }

  async extract(ctx: ParseContext): Promise<ExtractedRecipeData> {
    const data = await this.callGroq(ctx);
    if (data.confidence < ESCALATION_THRESHOLD && this.escalation) return this.escalation.extract(ctx);
    return data;
  }

  private async callGroq(ctx: ParseContext): Promise<ExtractedRecipeData> {
    const res = await fetch(GROQ_CHAT_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: QWEN_MODEL,
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

// Dev/test double: derives a recipe from the caption's first line, no network.
export class StubExtractor implements RecipeExtractor {
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

export function selectExtractor(): RecipeExtractor {
  return env.GROQ_API_KEY ? GroqExtractor.create() : new StubExtractor();
}
