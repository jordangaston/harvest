import { describe, it, expect, afterEach, vi } from 'vitest';
import { mapIngredientIcon } from '../../src/parse/icons.js';

// TC-7 (AC-7): mapIngredientIcon maps known names and falls back for unknowns.
describe('mapIngredientIcon', () => {
  it('maps known ingredients to icon keys and unknowns to default', () => {
    expect(mapIngredientIcon('6 cloves garlic, minced')).toBe('garlic');
    expect(mapIngredientIcon('1/2 cup butter, melted')).toBe('butter');
    expect(mapIngredientIcon('2 cups beef stock')).toBe('beefStock');
    expect(mapIngredientIcon('3 ripe bananas')).toBe('banana');
    expect(mapIngredientIcon('1 pinch of saffron')).toBe('default');
  });
});

// TC-6 (AC-6): select* return stubs without GROQ_API_KEY, real with it.
// Selection reads env at import, so each case resets modules and stubs env.
describe('provider selection by env', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function selectors(groqKey?: string) {
    vi.resetModules();
    if (groqKey) vi.stubEnv('GROQ_API_KEY', groqKey);
    else vi.stubEnv('GROQ_API_KEY', '');
    const asr = await import('../../src/parse/asr.js');
    const vision = await import('../../src/parse/vision.js');
    const extractor = await import('../../src/parse/extractor.js');
    return {
      transcriber: asr.selectTranscriber(),
      StubTranscriber: asr.StubTranscriber,
      GroqWhisper: asr.GroqWhisper,
      recipeExtractor: extractor.selectExtractor(),
      StubExtractor: extractor.StubExtractor,
      GroqExtractor: extractor.GroqExtractor,
    };
  }

  it('returns stubs for ASR/extraction when GROQ_API_KEY is absent', async () => {
    const s = await selectors();
    expect(s.transcriber).toBeInstanceOf(s.StubTranscriber);
    expect(s.recipeExtractor).toBeInstanceOf(s.StubExtractor);
  });

  it('returns real Groq providers for ASR/extraction when GROQ_API_KEY is set', async () => {
    const s = await selectors('gsk_test');
    expect(s.transcriber).toBeInstanceOf(s.GroqWhisper);
    expect(s.recipeExtractor).toBeInstanceOf(s.GroqExtractor);
  });
});

// Vision selection is gated on NODE_ENV (not a key): the offline stub under
// test, local Tesseract OCR otherwise. Selection reads env at import.
describe('vision selection by env', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function selectVisionUnder(nodeEnv: string) {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', nodeEnv);
    const vision = await import('../../src/parse/vision.js');
    return {
      instance: vision.selectVision(),
      StubVision: vision.StubVision,
      NativeTesseractReader: vision.NativeTesseractReader,
      TesseractReader: vision.TesseractReader,
    };
  }

  it('uses the offline stub under test', async () => {
    const s = await selectVisionUnder('test');
    expect(s.instance).toBeInstanceOf(s.StubVision);
  });

  it('uses a local Tesseract reader (native or WASM) outside test', async () => {
    const s = await selectVisionUnder('development');
    const isLocalOcr = s.instance instanceof s.NativeTesseractReader || s.instance instanceof s.TesseractReader;
    expect(isLocalOcr).toBe(true);
  });
});
