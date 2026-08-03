import { env } from '../config/env.js';

/**
 * Frame vision (O-05): read on-screen text off sampled video frames (or a photo)
 * with Qwen-VL on Groq's OpenAI-compatible chat endpoint, frames sent as base64
 * `data:` image_url parts. Stub returns fixed text so tests run offline.
 */

const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';
// ponytail: model id from the Groq vision docs at build time; swap if Groq
// renames it — it's the only knob, no code change needed.
const QWEN_VL_MODEL = 'qwen/qwen3.6-27b';
const PROMPT = 'Transcribe every piece of on-screen text in these recipe video frames. Text only.';

export interface FrameReader {
  readFrames(images: Buffer[]): Promise<string>;
}

// Real Qwen-VL via Groq. Groq caps images per request; we send at most 5.
export class GroqVision implements FrameReader {
  constructor(private readonly apiKey: string) {}

  static create(): GroqVision {
    return new GroqVision(env.GROQ_API_KEY!);
  }

  async readFrames(images: Buffer[]): Promise<string> {
    const content = [
      { type: 'text', text: PROMPT },
      ...images.slice(0, 5).map((img) => ({
        type: 'image_url',
        image_url: { url: `data:image/jpeg;base64,${img.toString('base64')}` },
      })),
    ];
    const res = await fetch(GROQ_CHAT_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: QWEN_VL_MODEL, messages: [{ role: 'user', content }] }),
    });
    if (!res.ok) throw new Error(`Groq vision failed — HTTP ${res.status}`);
    const json = (await res.json()) as { choices: Array<{ message: { content: string } }> };
    return json.choices[0]?.message.content ?? '';
  }
}

// Dev/test double: no network, no spend.
export class StubVision implements FrameReader {
  static readonly TEXT = 'Garlic Butter Chicken\n2 chicken breasts\n3 cloves garlic\n2 tbsp butter';

  async readFrames(_images: Buffer[]): Promise<string> {
    return StubVision.TEXT;
  }
}

export function selectVision(): FrameReader {
  return env.GROQ_API_KEY ? GroqVision.create() : new StubVision();
}
