import { spawn } from 'node:child_process';

/**
 * Media extract (needs the ffmpeg binary): pull the audio track and sampled
 * frames from a video URL for Whisper (ASR) and Qwen-VL (on-screen text). ffmpeg
 * reads the remote URL directly — audio to mono 16 kHz WAV on stdout, frames a
 * scene-change + fps sample capped at `max`. Tests use the arg builders + stub.
 */

/** Where extracted frames land, and their count. */
export interface FramesResult {
  dir: string;
  paths: string[];
}

export class MediaExtractor {
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
   * @returns The output dir and the frame file paths
   * @throws If ffmpeg exits non-zero
   */
  async frames(videoUrl: string, outDir: string, max = 12): Promise<FramesResult> {
    await runFfmpeg(framesArgs(videoUrl, outDir, max));
    const paths = Array.from({ length: max }, (_, i) => `${outDir}/frame-${String(i + 1).padStart(3, '0')}.jpg`);
    return { dir: outDir, paths };
  }
}

/** Dev/test double: fixed outputs, no ffmpeg process. */
export class StubMediaExtractor {
  static readonly AUDIO = Buffer.from('stub-wav-bytes');

  async audio(_videoUrl: string): Promise<Buffer> {
    return StubMediaExtractor.AUDIO;
  }

  async frames(_videoUrl: string, outDir: string, max = 12): Promise<FramesResult> {
    const paths = Array.from({ length: max }, (_, i) => `${outDir}/frame-${String(i + 1).padStart(3, '0')}.jpg`);
    return { dir: outDir, paths };
  }
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
