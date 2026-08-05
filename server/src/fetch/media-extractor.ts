import { spawn } from 'node:child_process';
import { env } from '../config/env.js';

/**
 * Media extract (needs the ffmpeg binary): pull the audio track and sampled
 * frames from a video URL for Whisper (ASR) and Qwen-VL (on-screen text). ffmpeg
 * reads the remote URL directly, so no download step.
 */

export class MediaExtractor {
  /** @returns A live extractor (needs the ffmpeg binary on PATH). */
  static create(): MediaExtractor {
    return new MediaExtractor();
  }

  /**
   * Extract the audio track as a mono 16 kHz WAV buffer (Whisper's expected form).
   *
   * @param videoUrl - The remote (or local) video URL/path ffmpeg reads
   * @returns The WAV audio as a Buffer
   * @throws If ffmpeg exits non-zero
   */
  async audio(videoUrl: string): Promise<Buffer> {
    return runFfmpegToBuffer(audioArgs(videoUrl));
  }

  /**
   * Sample up to `max` frames (scene changes, then fps-capped) into `outDir` as
   * numbered JPEGs.
   *
   * @param videoUrl - The remote (or local) video URL/path ffmpeg reads
   * @param outDir - Directory the frames are written to (caller-owned)
   * @param max - Maximum frames to keep (default 12)
   * @returns The frame file paths
   * @throws If ffmpeg exits non-zero
   */
  async frames(videoUrl: string, outDir: string, max = 12): Promise<string[]> {
    await runFfmpeg(framesArgs(videoUrl, outDir, max));
    return framePaths(outDir, max);
  }
}

/** Dev/test double: fixed outputs, no ffmpeg process. */
export class StubMediaExtractor {
  static readonly AUDIO = Buffer.from('stub-wav-bytes');

  /** @returns The fixed stub WAV buffer (no ffmpeg). */
  async audio(_videoUrl: string): Promise<Buffer> {
    return StubMediaExtractor.AUDIO;
  }

  /**
   * Return the `max` frame paths without writing any files.
   * @param outDir - Directory the paths are rooted in
   * @param max - Number of paths to return (default 12)
   * @returns The would-be frame paths.
   */
  async frames(_videoUrl: string, outDir: string, max = 12): Promise<string[]> {
    return framePaths(outDir, max);
  }
}

/**
 * The stub under `NODE_ENV=test`, else the live extractor.
 * @returns The extractor for the current environment.
 */
// ponytail: no creds to gate on, so tests run the stub, everything else is live.
export function selectMediaExtractor(): MediaExtractor | StubMediaExtractor {
  return env.NODE_ENV === 'test' ? new StubMediaExtractor() : MediaExtractor.create();
}

/** The numbered JPEG paths ffmpeg's `frame-%03d.jpg` pattern writes into `outDir`. */
function framePaths(outDir: string, max: number): string[] {
  return Array.from({ length: max }, (_, i) => `${outDir}/frame-${String(i + 1).padStart(3, '0')}.jpg`);
}

/** ffmpeg args for a mono 16 kHz WAV on stdout (exported for arg-only tests). */
export function audioArgs(videoUrl: string): string[] {
  return ['-i', videoUrl, '-vn', '-ac', '1', '-ar', '16000', '-f', 'wav', 'pipe:1'];
}

/**
 * ffmpeg args for scene-change + fps frame sampling capped at `max`. `select`
 * keeps scene cuts, the `1 fps` fallback guarantees coverage on a static clip,
 * and `-frames:v max` bounds the count/cost.
 */
export function framesArgs(videoUrl: string, outDir: string, max: number): string[] {
  return [
    '-i',
    videoUrl,
    '-vf',
    "select='gt(scene,0.3)+not(mod(n,30))',fps=1",
    '-vsync',
    'vfr',
    '-frames:v',
    String(max),
    `${outDir}/frame-%03d.jpg`,
  ];
}

/**
 * Run ffmpeg for its side effects (discards stdout).
 * @throws If ffmpeg exits non-zero (message carries the last stderr).
 */
function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-500)}`)),
    );
  });
}

/**
 * Run ffmpeg and collect its stdout into a Buffer.
 * @returns The captured stdout bytes.
 * @throws If ffmpeg exits non-zero (message carries the last stderr).
 */
function runFfmpegToBuffer(args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    let stderr = '';
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-500)}`)),
    );
  });
}

/**
 * Downscale a JPEG buffer so its longer side is at most `maxSide` px (never
 * upscales), cutting OCR CPU roughly with the pixel count. Text stays legible
 * well below native resolution. Returns the original bytes if ffmpeg fails, so a
 * resize hiccup never blocks OCR.
 *
 * @param image - The source image bytes.
 * @param maxSide - The output's longer-side cap (default 720).
 * @returns The downscaled JPEG bytes (or the original on failure).
 */
export function scaleImage(image: Buffer, maxSide = 720): Promise<Buffer> {
  // scale='if(gt(iw,ih), min(maxSide,iw), -2)':'if(gt(iw,ih), -2, min(maxSide,ih))'
  const w = `if(gt(iw,ih),min(${maxSide},iw),-2)`;
  const h = `if(gt(iw,ih),-2,min(${maxSide},ih))`;
  return runFfmpegBufferToBuffer(['-i', 'pipe:0', '-vf', `scale=${w}:${h}`, '-f', 'mjpeg', 'pipe:1'], image).catch(
    () => image,
  );
}

/** Run ffmpeg with `input` on stdin, collecting stdout into a Buffer. */
function runFfmpegBufferToBuffer(args: string[], input: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    let stderr = '';
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-500)}`)),
    );
    child.stdin.on('error', reject);
    child.stdin.end(input);
  });
}
