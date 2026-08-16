import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RetryableError } from "workflow";
import { extractAudio, extractFrames, scaleImage, type VideoHeaders } from "../fetch/media-extractor.js";
import { selectTranscriber } from "../parse/asr.js";
import { selectVision, selectVisionEscalation, isWeakOcr, GroqRateLimitError } from "../parse/vision.js";
import { selectExtractor } from "../parse/extractor.js";
import { hasRecipe } from "../parse/mapping.js";
import type { ExtractedRecipeData } from "../parse/extractor.js";

/**
 * The media steps — the WDK `"use step"` units the workflow fans out. Each is its
 * own function invocation, so the per-frame reads run maximally parallel (one
 * frame per invocation) while the transcript runs alongside them. Ports the
 * video/photo/carousel branches of server/src/pipeline/import-pipeline.ts.
 *
 * FAN-OUT (founder correction #3): `extractMedia` is ONE step — ffmpeg pulls the
 * audio + up to 12 scaled frames and returns them as base64 (WDK `/tmp` is
 * per-invocation, so frames cross the step boundary as data, not files). Then the
 * workflow runs `Promise.all([transcribe(audio), Promise.all(frames.map(readFrame))])`
 * — the transcript and every frame each in their own invocation, all concurrent.
 * Wall-clock is ≈ one frame, not N.
 *
 * ponytail: scaled 720px JPEGs are ~30-80KB each; 12 base64'd frames add ~0.5-1MB
 * to the event log. That's well within WDK's payload budget and the price of the
 * fan-out (files can't cross invocations). If a future clip needs more frames,
 * lower the cap or the scale before reaching for a blob store.
 */

const transcriber = selectTranscriber();
const vision = selectVision();
const escalation = selectVisionEscalation();
const extractor = selectExtractor();

const MAX_FRAMES = 12;

/** Base64 audio + frames — all serializable, crosses the step boundary as data. */
export interface ExtractedMedia {
  audioBase64: string;
  frameBase64: string[];
}

/**
 * ONE step: ffmpeg reads `videoUrl` and returns the mono-16k WAV audio (base64) +
 * up to 12 scaled JPEG frames (base64). Frames land in a per-invocation `/tmp`
 * dir, read back within this same invocation, then discarded.
 * @throws Error carrying MEDIA_UNAVAILABLE when ffmpeg can't read the video.
 */
export async function extractMedia(videoUrl: string, headers?: VideoHeaders): Promise<ExtractedMedia> {
  "use step";
  console.log(`[step] extract-media start ${new Date().toISOString()}`);
  const dir = await mkdtemp(join(tmpdir(), "harvest-frames-"));
  try {
    const [audio, frames] = await Promise.all([
      extractAudio(videoUrl, headers),
      extractFrames(videoUrl, dir, MAX_FRAMES, headers),
    ]);
    return { audioBase64: audio.toString("base64"), frameBase64: frames.map((f) => f.toString("base64")) };
  } catch {
    throw new Error("MEDIA_UNAVAILABLE");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** ONE step: transcribe the base64 WAV (Groq Whisper). Runs in parallel with the
 * frame reads. @throws Error carrying MEDIA_UNAVAILABLE on a transcription failure. */
export async function transcribe(audioBase64: string): Promise<string> {
  "use step";
  console.log(`[step] transcribe start ${new Date().toISOString()}`);
  try {
    const text = await transcriber.transcribe(Buffer.from(audioBase64, "base64"));
    console.log(`[step] transcribe done  ${new Date().toISOString()} chars=${text.length}`);
    return text;
  } catch {
    throw new Error("MEDIA_UNAVAILABLE");
  }
}

/**
 * ONE step PER FRAME — the fan-out unit. Reads a single frame's on-screen text.
 *
 * Tiered fallback (founder correction, preserved): local Tesseract (WASM, CPU, no
 * token cap) is PRIMARY — fully parallel across the per-frame invocations. Only a
 * frame with the weak-OCR signature (ingredient-ish text but no method / too
 * short) escalates to Groq Qwen-VL.
 *
 * Rate-limit handling (decided-and-logged): the escalations run in SEPARATE
 * function invocations, so they can't share an in-process semaphore. Instead of a
 * shared limiter we let WDK back off per frame: on a Groq 429 we throw
 * `RetryableError(..., { retryAfter })`, so WDK reschedules THAT frame's
 * invocation after the provider's suggested delay — no frame is dropped, and the
 * common (Tesseract) path stays fully parallel and rate-limit-free.
 */
export async function readFrame(frameBase64: string): Promise<string> {
  "use step";
  // A short digest tags this frame across its start/done lines so overlapping
  // timestamps in the run log prove the per-frame invocations ran concurrently.
  // (Middle of the payload, not the shared JPEG-header prefix, so tags differ.)
  const tag = frameBase64.slice(frameBase64.length >> 1, (frameBase64.length >> 1) + 6);
  console.log(`[step] read-frame ${tag} start ${new Date().toISOString()}`);
  const image = Buffer.from(frameBase64, "base64");
  const text = await vision.readFrame(image);
  console.log(`[step] read-frame ${tag} done  ${new Date().toISOString()} chars=${text.length}`);
  if (!escalation || !isWeakOcr(text)) return text;
  try {
    const better = await escalation.readFrame(image);
    return better.trim().length > text.trim().length ? better : text;
  } catch (err) {
    if (err instanceof GroqRateLimitError) {
      throw new RetryableError("Groq VLM rate-limited — backing off this frame", {
        retryAfter: `${err.retryAfterSeconds}s`,
      });
    }
    // Any other VLM failure: the Tesseract read stands (don't drop the frame).
    return text;
  }
}
readFrame.maxRetries = 4;

/** ONE step: OCR a single photo's on-screen text (base64 image in).
 * @throws Error carrying MEDIA_UNAVAILABLE on a read failure. */
export async function describePhoto(imageBase64: string): Promise<string> {
  "use step";
  try {
    return await readFrame(imageBase64);
  } catch {
    throw new Error("MEDIA_UNAVAILABLE");
  }
}

/** Min OCR length for a carousel slide to be treated as a recipe (vs. a photo/cover). */
const CAROUSEL_RECIPE_MIN_CHARS = 800;

/** Browser-ish UA — Instagram's image CDN 403s an unadorned fetch client. */
const IMAGE_FETCH_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/**
 * ONE step PER SLIDE — the carousel fan-out unit. Fetch a slide image, OCR it
 * (Tesseract primary, VLM escalation on the weak signature), and extract a recipe
 * if it carries one. A slide we can't fetch/OCR, a photo/cover slide (short text),
 * or one with no recipe returns null. Ports `readSlideRecipe`.
 */
export async function readSlideRecipe(url: string): Promise<ExtractedRecipeData | null> {
  "use step";
  let image: Buffer;
  try {
    const res = await fetch(url, { headers: { "user-agent": IMAGE_FETCH_USER_AGENT } });
    if (!res.ok) return null;
    image = await scaleImage(Buffer.from(await res.arrayBuffer()));
  } catch {
    return null;
  }
  let text: string;
  try {
    text = await vision.readFrame(image);
  } catch {
    return null;
  }
  if (text.length < CAROUSEL_RECIPE_MIN_CHARS) return null;
  try {
    let data = await extractor.extract({ visionText: text });
    // Tesseract can read a dense card's ingredients but garble/miss its method →
    // a steps-less recipe. Re-read just that card with the VLM to recover steps.
    if (escalation && hasRecipe(data) && data.steps.length === 0) {
      try {
        const betterText = await escalation.readFrame(image);
        const better = await extractor.extract({ visionText: betterText });
        if (hasRecipe(better) && better.steps.length > 0) data = better;
      } catch {
        // escalation failed (incl. rate limit) — the Tesseract recipe stands.
      }
    }
    return hasRecipe(data) ? data : null;
  } catch {
    return null;
  }
}
