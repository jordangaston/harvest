import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";

/**
 * Media extraction via the BUNDLED ffmpeg-static binary (not bare `ffmpeg` on
 * PATH) so it runs in a deployed Vercel function, not just this host. ffmpeg reads
 * the remote video URL directly (no download step) and we cross the WDK step
 * boundary as serializable data: audio as a base64 WAV, frames as base64 JPEGs.
 *
 * Ported from server/src/fetch/media-extractor.ts. The one deliberate change: a
 * single `extractMedia` call pulls audio + up to 12 scaled frames and returns them
 * as base64 (WDK `/tmp` is per-invocation, so files can't cross a step boundary).
 */

/** The bundled ffmpeg binary path (throws at import if the package is broken). */
const FFMPEG = ffmpegPath as unknown as string;

/** Extra HTTP headers ffmpeg must send to fetch a protected video (Pinterest CDN). */
export type VideoHeaders = Record<string, string>;

/** The extracted media, all serializable — crosses the WDK step boundary as data. */
export interface ExtractedMedia {
  /** Mono 16 kHz WAV, base64 (Whisper's expected form). */
  audioBase64: string;
  /** Up to `max` scaled JPEG frames, base64. */
  frameBase64: string[];
}

/** `-headers` input option (before `-i`) so ffmpeg sends `headers` for a
 * protected video URL; empty when none are needed. Ported verbatim. */
function headerArgs(headers?: VideoHeaders): string[] {
  if (!headers || Object.keys(headers).length === 0) return [];
  const lines = Object.entries(headers)
    // ffmpeg can't decode a compressed HTTP body — let it request identity.
    .filter(([key]) => key.toLowerCase() !== "accept-encoding")
    .map(([key, value]) => `${key}: ${value}`)
    .join("\r\n");
  return ["-headers", `${lines}\r\n`];
}

/** ffmpeg args for a mono 16 kHz WAV on stdout. */
export function audioArgs(videoUrl: string, headers?: VideoHeaders): string[] {
  return [...headerArgs(headers), "-i", videoUrl, "-vn", "-ac", "1", "-ar", "16000", "-f", "wav", "pipe:1"];
}

/**
 * ffmpeg args for scene-change + fps frame sampling into `outDir`, capped at
 * `max`, each scaled so its longer side is ~`maxSide`px (cuts OCR CPU). `select`
 * keeps scene cuts, the `1 fps` fallback guarantees coverage on a static clip.
 */
export function framesArgs(videoUrl: string, outDir: string, max: number, maxSide = 720, headers?: VideoHeaders): string[] {
  return [
    ...headerArgs(headers),
    "-i",
    videoUrl,
    "-vf",
    `select='gt(scene,0.3)+not(mod(n,30))',fps=1,${scaleFilter(maxSide)}`,
    "-vsync",
    "vfr",
    "-frames:v",
    String(max),
    `${outDir}/frame-%03d.jpg`,
  ];
}

/**
 * A scale filter capping the longer side at `maxSide` (never upscales), with the
 * commas INSIDE the `if()`/`min()` expressions backslash-escaped. When ffmpeg args
 * are passed as a direct argv array (no shell), an unescaped comma inside a filter
 * argument is parsed as a filter-chain separator — "No such filter: 'ih)'". Shell
 * quoting hides this; argv exposes it.
 */
function scaleFilter(maxSide: number): string {
  const w = `if(gt(iw\\,ih)\\,min(${maxSide}\\,iw)\\,-2)`;
  const h = `if(gt(iw\\,ih)\\,-2\\,min(${maxSide}\\,ih))`;
  return `scale=${w}:${h}`;
}

/** ffmpeg args to downscale a single JPEG on stdin → stdout (longer side ≤ maxSide). */
export function scaleArgs(maxSide = 720): string[] {
  return ["-i", "pipe:0", "-vf", scaleFilter(maxSide), "-f", "mjpeg", "pipe:1"];
}

/** The numbered JPEG paths ffmpeg's `frame-%03d.jpg` pattern writes into `outDir`. */
export function framePaths(outDir: string, max: number): string[] {
  return Array.from({ length: max }, (_, i) => `${outDir}/frame-${String(i + 1).padStart(3, "0")}.jpg`);
}

/** Run the bundled ffmpeg for its side effects (discards stdout). */
function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-500)}`))));
  });
}

/** Run the bundled ffmpeg and collect stdout into a Buffer. */
function runFfmpegToBuffer(args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG, args, { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let stderr = "";
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-500)}`)),
    );
  });
}

/** Pull the mono-16k WAV audio track for `videoUrl` as a Buffer. */
export function extractAudio(videoUrl: string, headers?: VideoHeaders): Promise<Buffer> {
  return runFfmpegToBuffer(audioArgs(videoUrl, headers));
}

/**
 * Sample up to `max` scaled frames from `videoUrl` into `outDir` and read them
 * back as Buffers. Frames land in `/tmp` (caller-supplied `outDir`), which WDK
 * clears between invocations — so the caller reads them within the same step.
 */
export async function extractFrames(
  videoUrl: string,
  outDir: string,
  max = 12,
  headers?: VideoHeaders,
): Promise<Buffer[]> {
  const { readFile } = await import("node:fs/promises");
  await runFfmpeg(framesArgs(videoUrl, outDir, max, 720, headers));
  const paths = framePaths(outDir, max);
  const frames: Buffer[] = [];
  for (const p of paths) {
    try {
      frames.push(await readFile(p));
    } catch {
      // ffmpeg wrote fewer frames than `max` (short clip / few scene cuts) — stop.
      break;
    }
  }
  return frames;
}

/**
 * Downscale a JPEG buffer so its longer side is ≤ `maxSide`px (never upscales).
 * Returns the original bytes if ffmpeg fails, so a resize hiccup never blocks OCR.
 * Used for carousel slides fetched over HTTP (not via ffmpeg's frame sampler).
 */
export function scaleImage(image: Buffer, maxSide = 720): Promise<Buffer> {
  return runFfmpegBufferToBuffer(scaleArgs(maxSide), image).catch(() => image);
}

/** Run the bundled ffmpeg with `input` on stdin, collecting stdout into a Buffer. */
function runFfmpegBufferToBuffer(args: string[], input: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG, args, { stdio: ["pipe", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let stderr = "";
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-500)}`)),
    );
    child.stdin.on("error", reject);
    child.stdin.end(input);
  });
}
