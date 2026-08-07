import { cpus } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { createScheduler, createWorker, type Scheduler } from 'tesseract.js';
import { env } from '../config/env.js';
import { fetchWithRetry } from './http.js';

/**
 * Frame vision (O-05): read on-screen text off sampled video frames (or a photo).
 * The default reader is local Tesseract — printed recipe slides are its ideal
 * case, and it runs on CPU with no per-minute token cap, so a carousel's slides
 * OCR in parallel in seconds. `GroqVision` (Qwen-VL) remains as a swap-in option
 * for a GPU-offloaded path; the stub returns fixed text so tests run offline.
 */

const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';
// ponytail: model id from the Groq vision docs at build time; swap if Groq
// renames it — it's the only knob, no code change needed.
const QWEN_VL_MODEL = 'qwen/qwen3.6-27b';
const PROMPT =
  'Transcribe every piece of on-screen text in these recipe video frames — including ingredient ' +
  'names and amounts, cooking times, temperatures, heat settings, and any timers or measurements ' +
  'shown on screen. Preserve all numbers and units exactly. Text only.';

export interface FrameReader {
  readFrames(images: Buffer[]): Promise<string>;
}

/** Real Qwen-VL via Groq. Groq caps images per request; we send at most 5. */
export class GroqVision implements FrameReader {
  /** @param apiKey - Groq API key for Bearer auth. */
  constructor(private readonly apiKey: string) {}

  /** Wire the singleton env key. */
  static create(): GroqVision {
    return new GroqVision(env.GROQ_API_KEY!);
  }

  /**
   * @param images - Frame/photo buffers; only the first 5 are sent.
   * @returns The on-screen text, or `''` if none.
   * @throws Error - On a non-2xx Groq response.
   */
  async readFrames(images: Buffer[]): Promise<string> {
    const content = [
      { type: 'text', text: PROMPT },
      ...images.slice(0, 5).map((img) => ({
        type: 'image_url',
        image_url: { url: `data:image/jpeg;base64,${img.toString('base64')}` },
      })),
    ];
    const res = await fetchWithRetry(GROQ_CHAT_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      // Qwen-VL reasons before answering; `hidden` drops the <think> block so the
      // response is the transcribed text only, not the model's reasoning.
      body: JSON.stringify({ model: QWEN_VL_MODEL, reasoning_format: 'hidden', messages: [{ role: 'user', content }] }),
    });
    if (!res.ok) throw new Error(`Groq vision failed — HTTP ${res.status}`);
    const json = (await res.json()) as { choices: Array<{ message: { content: string } }> };
    return json.choices[0]?.message.content ?? '';
  }
}

/** Worker pool size — one per core (leaving one free), capped so a big box
 * doesn't spawn dozens of workers. A carousel's slides OCR across the pool. */
const OCR_POOL_SIZE = Math.min(8, Math.max(1, cpus().length - 1));

/** One shared Tesseract worker pool for the process, built on first use. */
let schedulerPromise: Promise<Scheduler> | null = null;

function ocrScheduler(): Promise<Scheduler> {
  schedulerPromise ??= (async () => {
    const scheduler = createScheduler();
    await Promise.all(
      Array.from({ length: OCR_POOL_SIZE }, async () => scheduler.addWorker(await createWorker('eng'))),
    );
    return scheduler;
  })();
  return schedulerPromise;
}

/** Terminate the OCR pool (for a clean test/process shutdown; no-op if unused). */
export async function terminateOcr(): Promise<void> {
  if (!schedulerPromise) return;
  const scheduler = await schedulerPromise;
  schedulerPromise = null;
  await scheduler.terminate();
}

/**
 * Local OCR via Tesseract (CPU, no rate limit). Recognizes every image in
 * parallel across the shared worker pool and joins the transcribed text.
 */
export class TesseractReader implements FrameReader {
  /**
   * @param images - Frame/slide/photo buffers.
   * @returns The transcribed on-screen text of all images, joined.
   */
  async readFrames(images: Buffer[]): Promise<string> {
    const scheduler = await ocrScheduler();
    const results = await Promise.all(images.map((img) => scheduler.addJob('recognize', img)));
    return results.map((result) => result.data.text).join('\n');
  }
}

/** Max concurrent OCR processes — one per core, so a big carousel doesn't
 * oversubscribe the box. Shared across every reader call in the process. */
const OCR_CONCURRENCY = Math.max(1, cpus().length);
let ocrRunning = 0;
const ocrWaiters: (() => void)[] = [];

/** Run `task` once an OCR slot is free, releasing it (and the next waiter) after. */
async function withOcrSlot<T>(task: () => Promise<T>): Promise<T> {
  if (ocrRunning >= OCR_CONCURRENCY) await new Promise<void>((resolve) => ocrWaiters.push(resolve));
  ocrRunning++;
  try {
    return await task();
  } finally {
    ocrRunning--;
    ocrWaiters.shift()?.();
  }
}

/** Whether the native `tesseract` binary is on PATH (probed once). */
let nativeTesseract: boolean | null = null;
function hasNativeTesseract(): boolean {
  if (nativeTesseract === null) {
    try {
      nativeTesseract = spawnSync('tesseract', ['--version']).status === 0;
    } catch {
      nativeTesseract = false;
    }
  }
  return nativeTesseract;
}

/** OCR one image with the native binary (stdin → stdout), bounded by the pool. */
function nativeRecognize(image: Buffer): Promise<string> {
  return withOcrSlot(
    () =>
      new Promise<string>((resolve, reject) => {
        const child = spawn('tesseract', ['-', 'stdout', '-l', 'eng'], { stdio: ['pipe', 'pipe', 'ignore'] });
        const chunks: Buffer[] = [];
        child.stdout.on('data', (chunk) => chunks.push(chunk));
        child.on('error', reject);
        child.on('close', (code) =>
          code === 0 ? resolve(Buffer.concat(chunks).toString()) : reject(new Error(`tesseract exited ${code}`)),
        );
        child.stdin.on('error', reject);
        child.stdin.end(image);
      }),
  );
}

/**
 * Local OCR via the native tesseract binary. Each image is a separate process,
 * so recognition runs across every core (2-4x faster than the WASM build) with
 * no worker pool to manage. Concurrency is bounded to the core count.
 */
export class NativeTesseractReader implements FrameReader {
  /**
   * @param images - Frame/slide/photo buffers.
   * @returns The transcribed text of all images, joined.
   */
  async readFrames(images: Buffer[]): Promise<string> {
    const texts = await Promise.all(images.map((img) => nativeRecognize(img)));
    return texts.join('\n');
  }
}

/** Dev/test double: no network, no CPU spend. */
export class StubVision implements FrameReader {
  static readonly TEXT = 'Garlic Butter Chicken\n2 chicken breasts\n3 cloves garlic\n2 tbsp butter';

  /** @returns Fixed on-screen text. */
  async readFrames(_images: Buffer[]): Promise<string> {
    return StubVision.TEXT;
  }
}

/** The offline stub under test, else local Tesseract OCR — the native binary
 * when present (fastest), else the bundled WASM build (portable). Swap in
 * GroqVision here for a GPU-offloaded path. */
export function selectVision(): FrameReader {
  if (env.NODE_ENV === 'test') return new StubVision();
  return hasNativeTesseract() ? new NativeTesseractReader() : new TesseractReader();
}

/** A more capable reader to fall back to when Tesseract half-reads a dense,
 * stylized carousel slide — it reads the ingredient list but garbles/misses the
 * method, yielding a steps-less recipe. The Qwen-VL VLM reads the whole card,
 * method included. Used only for the few slides that need recovery (not every
 * slide — 11 parallel VLM calls exceed the model's token-per-minute cap and drop
 * recipes), so `null` when unkeyed or under test disables the escalation. */
export function selectVisionEscalation(): FrameReader | null {
  return env.NODE_ENV !== 'test' && env.GROQ_API_KEY ? GroqVision.create() : null;
}
