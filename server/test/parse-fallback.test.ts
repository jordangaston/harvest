import { describe, it, expect, afterEach } from "vitest";
import {
  FallbackTranscriber,
  WhisperTranscriber,
  StubTranscriber,
  selectTranscriber,
  type Transcriber,
} from "../src/parse/asr.js";
import {
  FallbackExtractor,
  ChatExtractor,
  DeepseekExtractor,
  StubExtractor,
  selectExtractor,
  type RecipeExtractor,
  type ExtractedRecipeData,
} from "../src/parse/extractor.js";
import {
  FallbackVision,
  GroqVision,
  GroqRateLimitError,
  selectVisionEscalation,
  type FrameReader,
} from "../src/parse/vision.js";

/**
 * Fast offline tests for the Groq-primary → OpenAI-fallback tier across ASR,
 * extraction, and vision. The fallback wrappers are driven by in-memory doubles (no
 * network), and the selectors are checked by toggling the env keys. We don't hit any
 * real API — that's the e2e tier.
 */

/** Reader/transcriber double that throws a chosen error. */
const throwing = (err: Error) => async () => {
  throw err;
};

const wav = Buffer.from("wav");
const img = Buffer.from("img");

const recipe = (title: string): ExtractedRecipeData => ({
  title,
  ingredients: [{ name: "egg", amount: "1", unit: null, quantityText: "1 egg" }],
  steps: ["do it"],
  confidence: 0.9,
});
const emptyRecipe: ExtractedRecipeData = { title: "", ingredients: [], steps: [], confidence: 0 };

describe("ASR fallback — Groq primary, OpenAI on error", () => {
  it("uses Groq when it succeeds (no OpenAI call)", async () => {
    let openaiCalled = false;
    const groq: Transcriber = { transcribe: async () => "groq text" };
    const openai: Transcriber = { transcribe: async () => ((openaiCalled = true), "openai text") };
    expect(await new FallbackTranscriber(groq, openai).transcribe(wav)).toBe("groq text");
    expect(openaiCalled).toBe(false);
  });

  it("routes to OpenAI on a Groq error (a simulated 429)", async () => {
    const groq: Transcriber = { transcribe: throwing(new Error("Groq transcription failed — HTTP 429")) };
    const openai: Transcriber = { transcribe: async () => "openai text" };
    expect(await new FallbackTranscriber(groq, openai).transcribe(wav)).toBe("openai text");
  });
});

describe("extraction fallback — Groq primary, OpenAI on error or weak output", () => {
  it("uses Groq when it returns a usable recipe (no OpenAI call)", async () => {
    let openaiCalled = false;
    const groq: RecipeExtractor = { extract: async () => recipe("Groq Cake") };
    const openai: RecipeExtractor = { extract: async () => ((openaiCalled = true), recipe("OpenAI Cake")) };
    const out = await new FallbackExtractor(groq, openai).extract({ caption: "cake" });
    expect(out.title).toBe("Groq Cake");
    expect(openaiCalled).toBe(false);
  });

  it("routes to OpenAI on a Groq error", async () => {
    const groq: RecipeExtractor = { extract: throwing(new Error("Groq extraction failed — HTTP 429")) };
    const openai: RecipeExtractor = { extract: async () => recipe("OpenAI Cake") };
    const out = await new FallbackExtractor(groq, openai).extract({ caption: "cake" });
    expect(out.title).toBe("OpenAI Cake");
  });

  it("routes to OpenAI when Groq returns a weak/empty recipe", async () => {
    const groq: RecipeExtractor = { extract: async () => emptyRecipe };
    const openai: RecipeExtractor = { extract: async () => recipe("OpenAI Cake") };
    const out = await new FallbackExtractor(groq, openai).extract({ caption: "cake" });
    expect(out.title).toBe("OpenAI Cake");
  });

  it("returns the weak Groq result when OpenAI also fails (shape preserved)", async () => {
    const groq: RecipeExtractor = { extract: async () => emptyRecipe };
    const openai: RecipeExtractor = { extract: throwing(new Error("OpenAI extraction failed — HTTP 500")) };
    const out = await new FallbackExtractor(groq, openai).extract({ caption: "cake" });
    expect(out).toEqual(emptyRecipe);
  });
});

describe("vision escalation fallback — Groq primary, OpenAI on error", () => {
  it("uses Groq when it succeeds (no OpenAI call)", async () => {
    let openaiCalled = false;
    const groq: FrameReader = { readFrame: async () => "groq ocr" };
    const openai: FrameReader = { readFrame: async () => ((openaiCalled = true), "openai ocr") };
    expect(await new FallbackVision(groq, openai).readFrame(img)).toBe("groq ocr");
    expect(openaiCalled).toBe(false);
  });

  it("routes to OpenAI on a Groq 429", async () => {
    const groq: FrameReader = { readFrame: throwing(new GroqRateLimitError(30)) };
    const openai: FrameReader = { readFrame: async () => "openai ocr" };
    expect(await new FallbackVision(groq, openai).readFrame(img)).toBe("openai ocr");
  });

  it("re-throws the Groq rate-limit when OpenAI also fails (WDK backoff still fires)", async () => {
    const groq: FrameReader = { readFrame: throwing(new GroqRateLimitError(30)) };
    const openai: FrameReader = { readFrame: throwing(new Error("OpenAI vision failed — HTTP 500")) };
    await expect(new FallbackVision(groq, openai).readFrame(img)).rejects.toBeInstanceOf(GroqRateLimitError);
  });
});

describe("selectors — fallback wired only when OPENAI_API_KEY is present", () => {
  const saved = {
    groq: process.env.GROQ_API_KEY,
    openai: process.env.OPENAI_API_KEY,
    deepseek: process.env.DEEPSEEK_API_KEY,
    node: process.env.NODE_ENV,
  };
  const restore = (key: string, value: string | undefined) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };
  afterEach(() => {
    restore("GROQ_API_KEY", saved.groq);
    restore("OPENAI_API_KEY", saved.openai);
    restore("DEEPSEEK_API_KEY", saved.deepseek);
    process.env.NODE_ENV = saved.node;
  });

  it("ASR: Groq-only when OPENAI_API_KEY absent", () => {
    process.env.GROQ_API_KEY = "g";
    delete process.env.OPENAI_API_KEY;
    expect(selectTranscriber()).toBeInstanceOf(WhisperTranscriber);
  });

  it("ASR: fallback when both keys present; stub when no Groq key", () => {
    process.env.GROQ_API_KEY = "g";
    process.env.OPENAI_API_KEY = "o";
    expect(selectTranscriber()).toBeInstanceOf(FallbackTranscriber);
    delete process.env.GROQ_API_KEY;
    expect(selectTranscriber()).toBeInstanceOf(StubTranscriber);
  });

  it("extraction: Groq-only when OPENAI_API_KEY absent, fallback when present", () => {
    delete process.env.DEEPSEEK_API_KEY;
    process.env.GROQ_API_KEY = "g";
    delete process.env.OPENAI_API_KEY;
    expect(selectExtractor()).toBeInstanceOf(ChatExtractor);
    process.env.OPENAI_API_KEY = "o";
    expect(selectExtractor()).toBeInstanceOf(FallbackExtractor);
    delete process.env.GROQ_API_KEY;
    expect(selectExtractor()).toBeInstanceOf(StubExtractor);
  });

  it("extraction: DeepSeek is the primary (main provider) when DEEPSEEK_API_KEY is set", () => {
    delete process.env.GROQ_API_KEY;
    delete process.env.OPENAI_API_KEY;
    process.env.DEEPSEEK_API_KEY = "d";
    // DeepSeek alone → the main-exact DeepseekExtractor (no fallback wrapper).
    expect(selectExtractor()).toBeInstanceOf(DeepseekExtractor);
    // DeepSeek + OpenAI → DeepSeek primary behind the fallback seam.
    process.env.OPENAI_API_KEY = "o";
    expect(selectExtractor()).toBeInstanceOf(FallbackExtractor);
  });

  it("vision escalation: Groq-only when OPENAI absent, fallback when present, null under test", () => {
    process.env.NODE_ENV = "development";
    process.env.GROQ_API_KEY = "g";
    delete process.env.OPENAI_API_KEY;
    expect(selectVisionEscalation()).toBeInstanceOf(GroqVision);
    process.env.OPENAI_API_KEY = "o";
    expect(selectVisionEscalation()).toBeInstanceOf(FallbackVision);
    process.env.NODE_ENV = "test";
    expect(selectVisionEscalation()).toBeNull();
  });
});
