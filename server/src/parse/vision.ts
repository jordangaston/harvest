import { createWorker } from "tesseract.js";
import { retryAfterSeconds } from "./http.js";

/**
 * Frame vision (O-05): read on-screen text off a video frame or carousel slide.
 * Ported from server/src/parse/vision.ts, adapted for the WDK per-frame fan-out.
 *
 * The primary reader is local Tesseract via the WASM build (NOT the native
 * `tesseract` binary — the WASM path runs in a deployed Vercel function). Each
 * `readFrame` step is its own invocation, so it OCRs a single frame with a
 * throwaway worker — there's no shared in-process pool to manage across
 * invocations (that's the fan-out's whole point).
 *
 * A frame with the weak-OCR signature (ingredient-ish text but no method / very
 * short) escalates to Groq Qwen-VL. Groq's ~8k TPM cap is respected at the
 * workflow layer: GroqVision surfaces a rate-limit as `GroqRateLimitError` so the
 * step can back off via WDK's `RetryableError` — no frame is dropped.
 */

const GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions";
const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
// ponytail: model id from the Groq vision docs; swap the id if Groq renames it —
// it's the only knob, no code change needed.
const QWEN_VL_MODEL = "qwen/qwen3-32b";
// ponytail: OpenAI VLM fallback model id from the gpt-5.6-luna doc; swap if renamed.
const OPENAI_VL_MODEL = "gpt-5.6-luna";
const PROMPT =
  "Transcribe every piece of on-screen text in this recipe video frame — including ingredient " +
  "names and amounts, cooking times, temperatures, heat settings, and any timers or measurements " +
  "shown on screen. Preserve all numbers and units exactly. Text only.";

/** A single-image OCR reader — the per-frame unit the fan-out runs. */
export interface FrameReader {
  readFrame(image: Buffer): Promise<string>;
}

/** Groq rate-limited the request; carries the server's suggested backoff (seconds). */
export class GroqRateLimitError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super("GROQ_RATE_LIMIT");
    this.name = "GroqRateLimitError";
  }
}

/**
 * Local OCR via Tesseract's WASM build. One frame per call; a fresh worker per
 * invocation (the fan-out gives each frame its own function, so a shared pool
 * would span nothing). Terminates the worker so the invocation exits clean.
 */
export class TesseractReader implements FrameReader {
  async readFrame(image: Buffer): Promise<string> {
    const worker = await createWorker("eng");
    try {
      const { data } = await worker.recognize(image);
      return data.text;
    } finally {
      await worker.terminate();
    }
  }
}

/** Real Qwen-VL via Groq — the escalation reader for a weak-OCR frame. */
export class GroqVision implements FrameReader {
  constructor(private readonly apiKey: string) {}

  static create(): GroqVision {
    return new GroqVision(process.env.GROQ_API_KEY!);
  }

  /**
   * @throws GroqRateLimitError - On a 429 (TPM cap), so the caller can back off.
   * @throws Error - On any other non-2xx Groq response.
   */
  async readFrame(image: Buffer): Promise<string> {
    const res = await fetch(GROQ_CHAT_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model: QWEN_VL_MODEL, reasoning_format: "hidden", messages: [{ role: "user", content: visionContent(image) }] }),
    });
    if (res.status === 429) throw new GroqRateLimitError(retryAfterSeconds(res) || 60);
    if (!res.ok) throw new Error(`Groq vision failed — HTTP ${res.status}`);
    const json = (await res.json()) as { choices: Array<{ message: { content: string } }> };
    return json.choices[0]?.message.content ?? "";
  }
}

/** The base64 data-URL `image_url` content parts for a frame — shared by both VLMs. */
function visionContent(image: Buffer): Array<Record<string, unknown>> {
  return [
    { type: "text", text: PROMPT },
    { type: "image_url", image_url: { url: `data:image/jpeg;base64,${image.toString("base64")}` } },
  ];
}

/** OpenAI gpt-5.6-luna VLM — the escalation fallback when Groq rate-limits/errors. */
export class OpenAiVision implements FrameReader {
  constructor(private readonly apiKey: string) {}

  static create(): OpenAiVision {
    return new OpenAiVision(process.env.OPENAI_API_KEY!);
  }

  async readFrame(image: Buffer): Promise<string> {
    const res = await fetch(OPENAI_CHAT_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model: OPENAI_VL_MODEL, messages: [{ role: "user", content: visionContent(image) }] }),
    });
    if (!res.ok) throw new Error(`OpenAI vision failed — HTTP ${res.status}`);
    const json = (await res.json()) as { choices: Array<{ message: { content: string } }> };
    return json.choices[0]?.message.content ?? "";
  }
}

/**
 * The VLM escalation reader with Groq primary and an OpenAI fallback. On a Groq 429
 * or any other error, tries OpenAI. If OpenAI also fails and the Groq failure was a
 * rate-limit, re-throws `GroqRateLimitError` so the workflow's WDK backoff still
 * fires — otherwise the frame's Tesseract read stands (the caller swallows a plain
 * error).
 */
export class FallbackVision implements FrameReader {
  constructor(
    private readonly primary: FrameReader,
    private readonly fallback: FrameReader,
  ) {}

  async readFrame(image: Buffer): Promise<string> {
    try {
      return await this.primary.readFrame(image);
    } catch (err) {
      try {
        return await this.fallback.readFrame(image);
      } catch {
        throw err;
      }
    }
  }
}

/** Dev/test double: no network, no CPU spend. */
export class StubVision implements FrameReader {
  static readonly TEXT = "Garlic Butter Chicken\n2 chicken breasts\n3 cloves garlic\n2 tbsp butter";

  async readFrame(_image: Buffer): Promise<string> {
    return StubVision.TEXT;
  }
}

/**
 * Whether a frame's OCR text is "weak" — has ingredient-ish content but no method,
 * or is too short to trust. This is the escalation signature: Tesseract can read a
 * dense stylized card's ingredients while garbling/missing the numbered method.
 * Such a frame escalates to the VLM; a clean read stands. Ported from the server's
 * escalate-only-the-failing-card heuristic.
 */
const WEAK_OCR_MIN_CHARS = 40;
const INGREDIENT_HINT = /\b(\d|cup|tbsp|tsp|teaspoon|tablespoon|gram|g\b|ounce|oz|lb|pound|clove|slice)\b/i;
const METHOD_HINT = /\b(mix|stir|bake|cook|fry|heat|add|combine|whisk|simmer|boil|roast|preheat|pour|serve|blend|season|fold|saut)\w*/i;

export function isWeakOcr(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < WEAK_OCR_MIN_CHARS) return true;
  return INGREDIENT_HINT.test(trimmed) && !METHOD_HINT.test(trimmed);
}

/** Tesseract (WASM) under normal env; the offline stub when unkeyed/under test. */
export function selectVision(): FrameReader {
  return process.env.NODE_ENV === "test" ? new StubVision() : new TesseractReader();
}

/**
 * The VLM escalation reader, or null when unkeyed/under test (escalation off).
 * Groq primary, with an OpenAI gpt-5.6-luna fallback on a Groq 429/error when
 * OPENAI_API_KEY is present.
 */
export function selectVisionEscalation(): FrameReader | null {
  if (process.env.NODE_ENV === "test" || !process.env.GROQ_API_KEY) return null;
  const groq = GroqVision.create();
  return process.env.OPENAI_API_KEY ? new FallbackVision(groq, OpenAiVision.create()) : groq;
}
