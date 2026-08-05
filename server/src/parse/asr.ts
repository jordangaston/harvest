import { env } from '../config/env.js';
import { groqFetch } from './groq.js';

/**
 * Audio transcription (O-04). Real path posts a WAV to Groq's OpenAI-compatible
 * Whisper endpoint; the stub returns a fixed transcript so tests run offline.
 * Selected by GROQ_API_KEY presence — going live is an env swap.
 */

const GROQ_TRANSCRIPTIONS_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const WHISPER_MODEL = 'whisper-large-v3-turbo';

export interface Transcriber {
  transcribe(wav: Buffer): Promise<string>;
}

/**
 * Real Whisper via Groq (multipart: `file` + `model`, Bearer auth). Not
 * network-verified offline; coded to the current Groq speech-to-text docs.
 */
export class GroqWhisper implements Transcriber {
  /** @param apiKey - Groq API key for Bearer auth. */
  constructor(private readonly apiKey: string) {}

  /** Wire the singleton env key. */
  static create(): GroqWhisper {
    return new GroqWhisper(env.GROQ_API_KEY!);
  }

  /**
   * @param wav - WAV audio to transcribe.
   * @returns The transcript text.
   * @throws Error - On a non-2xx Groq response.
   */
  async transcribe(wav: Buffer): Promise<string> {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'audio.wav');
    form.append('model', WHISPER_MODEL);
    const res = await groqFetch(GROQ_TRANSCRIPTIONS_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}` },
      body: form,
    });
    if (!res.ok) throw new Error(`Groq transcription failed — HTTP ${res.status}`);
    return ((await res.json()) as { text: string }).text;
  }
}

/** Dev/test double: no network, no spend. */
export class StubTranscriber implements Transcriber {
  static readonly TRANSCRIPT = 'Add the chicken, then the teriyaki sauce, and simmer.';

  /** @returns A fixed transcript. */
  async transcribe(_wav: Buffer): Promise<string> {
    return StubTranscriber.TRANSCRIPT;
  }
}

/** Groq if keyed, else the offline stub. */
export function selectTranscriber(): Transcriber {
  return env.GROQ_API_KEY ? GroqWhisper.create() : new StubTranscriber();
}
