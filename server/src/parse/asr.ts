import { fetchWithRetry } from "./http.js";

/**
 * Audio transcription (O-04): post a WAV to an OpenAI-compatible Whisper endpoint.
 * Groq is PRIMARY; when OPENAI_API_KEY is set, OpenAI whisper-1 is the FALLBACK on a
 * Groq 429 / network error / non-2xx. Ported from server/src/parse/asr.ts. Absent
 * GROQ_API_KEY, the stub returns a fixed transcript so fast tests run offline.
 */

const GROQ_TRANSCRIPTIONS_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const GROQ_WHISPER_MODEL = "whisper-large-v3-turbo";
const OPENAI_TRANSCRIPTIONS_URL = "https://api.openai.com/v1/audio/transcriptions";
// ponytail: OpenAI ASR fallback model id from the whisper-1 doc; swap if renamed.
const OPENAI_WHISPER_MODEL = "whisper-1";

export interface Transcriber {
  transcribe(wav: Buffer): Promise<string>;
}

/**
 * Whisper via any OpenAI-compatible transcription endpoint (Groq or OpenAI): a
 * multipart POST (`file` + `model`, Bearer auth) returning `{ text }`. Only the URL
 * and model id differ between providers.
 */
export class WhisperTranscriber implements Transcriber {
  constructor(
    private readonly apiKey: string,
    private readonly url: string,
    private readonly model: string,
    private readonly label: string,
  ) {}

  /** Groq transcriber from the env key. */
  static groq(): WhisperTranscriber {
    return new WhisperTranscriber(process.env.GROQ_API_KEY!, GROQ_TRANSCRIPTIONS_URL, GROQ_WHISPER_MODEL, "Groq");
  }

  /** OpenAI whisper-1 transcriber from the env key. */
  static openai(): WhisperTranscriber {
    return new WhisperTranscriber(process.env.OPENAI_API_KEY!, OPENAI_TRANSCRIPTIONS_URL, OPENAI_WHISPER_MODEL, "OpenAI");
  }

  async transcribe(wav: Buffer): Promise<string> {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "audio.wav");
    form.append("model", this.model);
    const res = await fetchWithRetry(this.url, {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}` },
      body: form,
    });
    if (!res.ok) throw new Error(`${this.label} transcription failed — HTTP ${res.status}`);
    return ((await res.json()) as { text: string }).text;
  }
}

/** Groq primary, OpenAI whisper-1 fallback on a Groq 429 / network error / non-2xx. */
export class FallbackTranscriber implements Transcriber {
  constructor(
    private readonly primary: Transcriber,
    private readonly fallback: Transcriber,
  ) {}

  async transcribe(wav: Buffer): Promise<string> {
    try {
      return await this.primary.transcribe(wav);
    } catch {
      return this.fallback.transcribe(wav);
    }
  }
}

/** Dev/test double: no network, no spend. */
export class StubTranscriber implements Transcriber {
  static readonly TRANSCRIPT = "Add the chicken, then the teriyaki sauce, and simmer.";

  async transcribe(_wav: Buffer): Promise<string> {
    return StubTranscriber.TRANSCRIPT;
  }
}

/**
 * The transcriber for the current env: Groq primary with an OpenAI whisper-1
 * fallback when both keys are present; Groq-only when only GROQ_API_KEY is set;
 * else the offline stub.
 */
export function selectTranscriber(): Transcriber {
  if (!process.env.GROQ_API_KEY) return new StubTranscriber();
  const groq = WhisperTranscriber.groq();
  return process.env.OPENAI_API_KEY ? new FallbackTranscriber(groq, WhisperTranscriber.openai()) : groq;
}
