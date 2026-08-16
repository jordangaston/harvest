import { fetchWithRetry } from "./http.js";
import type { ExtractedRecipe } from "./website.js";
import { parseIngredientLine, type StructuredIngredient } from "./ingredient.js";
import { LABEL_CORE_KEYS, type LabelCoreText } from "../models/label-core.js";
import { hasRecipe } from "./mapping.js";

/**
 * Recipe extraction (O-06): turn caption/transcript/vision text into a structured
 * recipe (JSON) with a confidence score. DeepSeek is the primary live path (the
 * main provider — OpenAI-compatible, JSON mode, thinking disabled); Groq is kept
 * as an available OpenAI-compatible tier; OpenAI gpt-5.6-luna is the LAST-RESORT
 * fallback. The stub derives a deterministic recipe from the caption so tests run
 * offline. C3: ingredients come back structured (name/amount/unit); C5: an
 * optional per-serving nutrition label core.
 *
 * Ported from server/src/parse/extractor.ts (DeepseekExtractor + prompt/coercion
 * verbatim); the env module is swapped for direct `process.env` reads. The
 * Groq/OpenAI ChatExtractor + FallbackExtractor are the migration's fallback seam.
 *
 * ── FOUNDER FLAG (OpenAI fallback) ────────────────────────────────────────────
 * For a main-EXACT extractor, `selectExtractor` should return only
 * `DeepseekExtractor.create()` when `DEEPSEEK_API_KEY` is set (else `StubExtractor`).
 * Everything Groq/OpenAI below — `ChatExtractor`, `FallbackExtractor`, and their
 * branches in `selectExtractor` — is the retained fallback tier. Drop them (and
 * their branches) to be byte-identical to main.
 */

const DEEPSEEK_CHAT_URL = "https://api.deepseek.com/chat/completions";
// ponytail: swap the id if DeepSeek renames it.
const EXTRACTION_MODEL = "deepseek-v4-flash";
const GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions";
const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
// ponytail: pin the Groq model; swap the id if Groq renames it.
const GROQ_EXTRACTION_MODEL = "llama-3.3-70b-versatile";
// ponytail: OpenAI fallback model id from the gpt-5.6-luna doc; swap if renamed.
const OPENAI_EXTRACTION_MODEL = "gpt-5.6-luna";

/** The signals an extractor reads. `structured` is a JSON-LD shortcut. */
export interface ParseContext {
  caption?: string;
  transcript?: string;
  visionText?: string;
  structured?: ExtractedRecipe;
}

/** ExtractedRecipe with structured ingredients + a 0–1 confidence. `ingredients`
 * is structured (not the raw `string[]` of `ExtractedRecipe`), so this omits and
 * re-declares it. `nutrition` is the parsed/derived per-serving label core. */
export interface ExtractedRecipeData extends Omit<ExtractedRecipe, "ingredients"> {
  ingredients: StructuredIngredient[];
  nutrition?: LabelCoreText;
  confidence: number;
}

export interface RecipeExtractor {
  extract(ctx: ParseContext): Promise<ExtractedRecipeData>;
}

const SYSTEM_PROMPT =
  "Extract a recipe as JSON with keys: title (string), ingredients (array), " +
  "steps (string[]), servings (string, optional), totalMinutes (number, optional), " +
  "imageUrl (string, optional), nutrition (object, optional), confidence (number 0-1). " +
  "Each ingredient is an object {name, amount, unit, raw}: name = the ingredient itself " +
  "(no quantity, no prep words); amount = a number or null; unit = lowercase singular " +
  '("teaspoon"/"tablespoon"/"cup"/"ounce"/"pound"/"gram"/"count") or null; raw = the verbatim ' +
  "source line. Combine multiple amounts of one ingredient into the smallest unit in the same " +
  "system (1 tbsp + 1 tsp -> 4 teaspoon); a range uses the upper bound. nutrition (only if the " +
  "source states it) is per serving: {calories, grams_of_fat, grams_of_saturated_fat, " +
  "grams_of_carbohydrate, grams_of_fiber, grams_of_sugar, grams_of_protein, milligrams_of_sodium} " +
  "as numbers. Use only the given text. " +
  "Write steps a cook can actually follow: preserve every cooking detail present in the source — " +
  "exact times, temperatures, heat levels, quantities, pan/tool, and the visual or textural doneness " +
  "cues that tell the cook when a step is done (e.g. \"sear 3-4 min per side until deep golden brown " +
  "and the edges crisp\"). Do not summarize, shorten, or merge steps; keep each distinct action as its " +
  "own step, in order. Never output an ingredient-section header (e.g. \"For the base\", \"To finish\", " +
  "\"For the sauce\") as a step or as an ingredient — those group the list, they are not instructions or " +
  "ingredients; omit them. Set confidence low when the text is thin or ambiguous.";

/** Flattens a ParseContext into one prompt string for the LLM. */
function contextText(ctx: ParseContext): string {
  return [
    ctx.caption && `Caption:\n${ctx.caption}`,
    ctx.transcript && `Transcript:\n${ctx.transcript}`,
    ctx.visionText && `On-screen text:\n${ctx.visionText}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Coerces one raw ingredient (object or string) into a StructuredIngredient. */
function toStructuredIngredient(raw: unknown): StructuredIngredient {
  if (typeof raw === "string") return parseIngredientLine(raw);
  if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    const name = typeof r.name === "string" ? r.name : "";
    const quantityText = typeof r.raw === "string" && r.raw ? r.raw : name;
    // A structured object without a name is unusable — fall back to parsing the line.
    if (!name) return parseIngredientLine(quantityText);
    return {
      name,
      amount: typeof r.amount === "number" ? String(r.amount) : null,
      unit: typeof r.unit === "string" && r.unit ? r.unit.toLowerCase() : null,
      quantityText,
    };
  }
  return { name: "", amount: null, unit: null, quantityText: "" };
}

/** Coerces the optional nutrition object into a label-core text map, or undefined. */
function toNutrition(raw: unknown): LabelCoreText | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const out = {} as LabelCoreText;
  let any = false;
  for (const key of LABEL_CORE_KEYS) {
    const v = r[key];
    if (typeof v === "number") {
      out[key] = String(v);
      any = true;
    } else {
      out[key] = "0";
    }
  }
  return any ? out : undefined;
}

/** Coerces a parsed LLM object into ExtractedRecipeData, defaulting confidence. */
function toData(raw: Record<string, unknown>): ExtractedRecipeData {
  return {
    title: typeof raw.title === "string" ? raw.title : "",
    ingredients: Array.isArray(raw.ingredients) ? raw.ingredients.map(toStructuredIngredient) : [],
    steps: Array.isArray(raw.steps) ? (raw.steps as string[]) : [],
    servings: typeof raw.servings === "string" ? raw.servings : undefined,
    totalMinutes: typeof raw.totalMinutes === "number" ? raw.totalMinutes : undefined,
    // Empty string → absent, so a thumbnail fallback (`?? thumbnail`) applies.
    imageUrl: typeof raw.imageUrl === "string" && raw.imageUrl ? raw.imageUrl : undefined,
    nutrition: toNutrition(raw.nutrition),
    confidence: typeof raw.confidence === "number" ? raw.confidence : 0.5,
  };
}

/** JSON recipe extraction via DeepSeek (OpenAI-compatible chat completions).
 * Ported verbatim from main — the primary live extractor. */
export class DeepseekExtractor implements RecipeExtractor {
  /** @param apiKey - DeepSeek API key for Bearer auth. */
  constructor(private readonly apiKey: string) {}

  /** Wire the singleton env key. */
  static create(): DeepseekExtractor {
    return new DeepseekExtractor(process.env.DEEPSEEK_API_KEY!);
  }

  /**
   * @param ctx - The parse signals to extract from.
   * @returns The structured recipe with a confidence score.
   * @throws Error - On a non-2xx DeepSeek response.
   */
  async extract(ctx: ParseContext): Promise<ExtractedRecipeData> {
    const res = await fetchWithRetry(DEEPSEEK_CHAT_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: EXTRACTION_MODEL,
        // Extraction is a direct parse, not a reasoning task — v4-flash thinks by
        // default (high effort), which is slow and empties JSON-mode output. Off.
        thinking: { type: "disabled" },
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: contextText(ctx) },
        ],
      }),
    });
    if (!res.ok) throw new Error(`DeepSeek extraction failed — HTTP ${res.status}`);
    const json = (await res.json()) as { choices: Array<{ message: { content: string } }> };
    return toData(JSON.parse(json.choices[0]?.message.content ?? "{}"));
  }
}

/**
 * JSON recipe extraction via any OpenAI-compatible chat-completions endpoint
 * (Groq or OpenAI). Same request shape, same prompt, same parsing — only the URL,
 * model id, and provider label differ. The retained fallback seam.
 */
export class ChatExtractor implements RecipeExtractor {
  /**
   * @param apiKey - Bearer auth token.
   * @param url - The chat-completions endpoint.
   * @param model - The model id.
   * @param label - Provider name, for error messages.
   */
  constructor(
    private readonly apiKey: string,
    private readonly url: string,
    private readonly model: string,
    private readonly label: string,
  ) {}

  /** Groq extractor from the env key. */
  static groq(): ChatExtractor {
    return new ChatExtractor(process.env.GROQ_API_KEY!, GROQ_CHAT_URL, GROQ_EXTRACTION_MODEL, "Groq");
  }

  /** OpenAI gpt-5.6-luna extractor from the env key. */
  static openai(): ChatExtractor {
    return new ChatExtractor(process.env.OPENAI_API_KEY!, OPENAI_CHAT_URL, OPENAI_EXTRACTION_MODEL, "OpenAI");
  }

  /**
   * @param ctx - The parse signals to extract from.
   * @returns The structured recipe with a confidence score.
   * @throws Error - On a non-2xx response.
   */
  async extract(ctx: ParseContext): Promise<ExtractedRecipeData> {
    const res = await fetchWithRetry(this.url, {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: contextText(ctx) },
        ],
      }),
    });
    if (!res.ok) throw new Error(`${this.label} extraction failed — HTTP ${res.status}`);
    const json = (await res.json()) as { choices: Array<{ message: { content: string } }> };
    return toData(JSON.parse(json.choices[0]?.message.content ?? "{}"));
  }
}

/**
 * Primary extractor with a fallback. Falls back when the primary throws (error /
 * rate-limit after http.ts's own 429 retries) OR returns a weak result — no usable
 * recipe (`hasRecipe` false). A weak primary that the fallback also can't beat
 * returns the primary's result, so the shape is unchanged for callers. Chainable,
 * so DeepSeek → Groq → OpenAI is a nested FallbackExtractor.
 */
export class FallbackExtractor implements RecipeExtractor {
  constructor(
    private readonly primary: RecipeExtractor,
    private readonly fallback: RecipeExtractor,
  ) {}

  async extract(ctx: ParseContext): Promise<ExtractedRecipeData> {
    let primaryResult: ExtractedRecipeData | undefined;
    try {
      primaryResult = await this.primary.extract(ctx);
      if (hasRecipe(primaryResult)) return primaryResult;
    } catch {
      // The primary errored/rate-limited — try the fallback.
    }
    try {
      return await this.fallback.extract(ctx);
    } catch {
      // Both failed. If the primary produced a (weak) result, return it; else rethrow.
      if (primaryResult) return primaryResult;
      throw new Error("Extraction failed — primary and fallback both unavailable");
    }
  }
}

/** Dev/test double: derives a recipe from the caption's first line, no network. */
export class StubExtractor implements RecipeExtractor {
  /**
   * @param ctx - Read for a caption/vision/transcript first line.
   * @returns A deterministic single-ingredient recipe (empty title → confidence 0).
   */
  async extract(ctx: ParseContext): Promise<ExtractedRecipeData> {
    const text = ctx.caption ?? ctx.visionText ?? ctx.transcript ?? "";
    const [firstLine] = text.split("\n");
    const title = (firstLine ?? "").replace(/[—-].*$/, "").trim();
    return {
      title,
      ingredients: title ? [parseIngredientLine("1 serving of " + title)] : [],
      steps: ["Prepare " + title],
      confidence: title ? 0.9 : 0,
    };
  }
}

/**
 * The extractor for the current env. Primary is DeepSeek (main), then Groq, then
 * OpenAI as the last resort — each present tier wraps the next behind one seam:
 *   DEEPSEEK + (GROQ|OPENAI) → FallbackExtractor(DeepSeek, next…)
 *   only DEEPSEEK           → DeepseekExtractor (main-exact)
 *   only GROQ (+OPENAI)     → Groq, optionally with the OpenAI fallback
 *   no keys                 → the offline stub.
 * FLAG: drop the Groq/OpenAI branches for a main-exact selector (see file header).
 */
export function selectExtractor(): RecipeExtractor {
  const tiers: RecipeExtractor[] = [];
  if (process.env.DEEPSEEK_API_KEY) tiers.push(DeepseekExtractor.create());
  if (process.env.GROQ_API_KEY) tiers.push(ChatExtractor.groq());
  // OpenAI is a LAST-RESORT fallback, never a standalone primary: it only joins
  // the chain behind a real primary (DeepSeek or Groq), so an OpenAI-only env
  // still runs the offline stub.
  if (tiers.length > 0 && process.env.OPENAI_API_KEY) tiers.push(ChatExtractor.openai());
  if (tiers.length === 0) return new StubExtractor();
  // Fold the tiers into a right-nested fallback chain: [a, b, c] → Fallback(a, Fallback(b, c)).
  return tiers.reduceRight((fallback, primary) => new FallbackExtractor(primary, fallback));
}
