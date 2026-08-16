import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  audioArgs,
  framesArgs,
  scaleArgs,
  framePaths,
  extractAudio,
  extractFrames,
} from "../src/fetch/media-extractor.js";
import { isWeakOcr, type FrameReader } from "../src/parse/vision.js";

/**
 * Fast offline media tests: the ffmpeg argument builders + frame-path helper (pure),
 * the tiered-fallback selection with fixed reader doubles, and the real ffmpeg
 * extraction against a tiny fixture clip (offline — the bundled ffmpeg-static
 * binary, no network). We don't test Groq/Apify guarantees here (that's the e2e tier).
 */

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "tiny.mp4");

describe("ffmpeg arg builders", () => {
  it("audioArgs asks for a mono 16k WAV on stdout", () => {
    expect(audioArgs("v.mp4")).toEqual(["-i", "v.mp4", "-vn", "-ac", "1", "-ar", "16000", "-f", "wav", "pipe:1"]);
  });

  it("audioArgs prepends -headers (dropping accept-encoding) when headers are given", () => {
    const args = audioArgs("v.mp4", { "User-Agent": "x", "Accept-Encoding": "gzip" });
    expect(args[0]).toBe("-headers");
    expect(args[1]).toContain("User-Agent: x");
    expect(args[1]).not.toContain("Accept-Encoding");
  });

  it("framesArgs scene-samples, scales, and caps the frame count", () => {
    const args = framesArgs("v.mp4", "/tmp/d", 12);
    expect(args).toContain("-frames:v");
    expect(args[args.indexOf("-frames:v") + 1]).toBe("12");
    const vf = args[args.indexOf("-vf") + 1];
    expect(vf).toContain("scene");
    expect(vf).toContain("scale=");
    expect(vf).toContain("fps=1");
    expect(args.at(-1)).toBe("/tmp/d/frame-%03d.jpg");
  });

  it("scaleArgs downscales a JPEG on stdin → mjpeg on stdout", () => {
    expect(scaleArgs()).toEqual(["-i", "pipe:0", "-vf", expect.stringContaining("scale="), "-f", "mjpeg", "pipe:1"]);
  });

  it("framePaths numbers frames 001..N under the out dir", () => {
    expect(framePaths("/x", 3)).toEqual(["/x/frame-001.jpg", "/x/frame-002.jpg", "/x/frame-003.jpg"]);
  });
});

describe("isWeakOcr — the escalation signature", () => {
  it("flags a too-short read", () => {
    expect(isWeakOcr("2 eggs")).toBe(true);
  });

  it("flags ingredients-but-no-method (the known failure)", () => {
    expect(isWeakOcr("2 cups flour, 1 tsp salt, 3 eggs, 200 grams butter, 1 cup milk")).toBe(true);
  });

  it("passes a clean read that has a method", () => {
    expect(isWeakOcr("2 cups flour and 3 eggs. Mix, then bake at 350 for 20 minutes until golden.")).toBe(false);
  });
});

describe("tiered fallback selection (fixed reader doubles)", () => {
  // The workflow's readFrame logic, distilled: Tesseract-primary, escalate only on
  // the weak signature. We drive it with doubles so no network/CPU is touched.
  const select = async (primary: FrameReader, escalation: FrameReader | null, img: Buffer): Promise<string> => {
    const text = await primary.readFrame(img);
    if (!escalation || !isWeakOcr(text)) return text;
    const better = await escalation.readFrame(img);
    return better.trim().length > text.trim().length ? better : text;
  };
  const reader = (out: string): FrameReader => ({ readFrame: async () => out });
  const img = Buffer.from("x");

  it("keeps the primary read when it is strong (no escalation call)", async () => {
    let escalated = false;
    const esc: FrameReader = { readFrame: async () => ((escalated = true), "vlm") };
    const out = await select(reader("2 cups flour. Mix and bake at 350 for 20 minutes."), esc, img);
    expect(out).toContain("bake");
    expect(escalated).toBe(false);
  });

  it("escalates a weak primary read to the VLM", async () => {
    const out = await select(reader("2 eggs"), reader("Full recipe: eggs, flour. Mix and bake 20 min."), img);
    expect(out).toContain("bake");
  });

  it("does not escalate when escalation is disabled (null)", async () => {
    expect(await select(reader("2 eggs"), null, img)).toBe("2 eggs");
  });
});

describe("real ffmpeg extraction against a tiny fixture (offline, bundled binary)", () => {
  it("extractAudio returns a non-empty WAV buffer", async () => {
    const wav = await extractAudio(FIXTURE);
    expect(wav.length).toBeGreaterThan(0);
    // A RIFF/WAVE header proves ffmpeg produced real WAV, not an empty pipe.
    expect(wav.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(wav.subarray(8, 12).toString("ascii")).toBe("WAVE");
  }, 30_000);

  it("extractFrames writes and reads back JPEG frames from /tmp", async () => {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const dir = mkdtempSync(join(tmpdir(), "harvest-frametest-"));
    try {
      const frames = await extractFrames(FIXTURE, dir, 12);
      expect(frames.length).toBeGreaterThan(0);
      // JPEG magic bytes (FF D8) — real image data crossed back as a Buffer.
      expect(frames[0][0]).toBe(0xff);
      expect(frames[0][1]).toBe(0xd8);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
