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
      vision: vision.selectVision(),
      StubVision: vision.StubVision,
      GroqVision: vision.GroqVision,
      recipeExtractor: extractor.selectExtractor(),
      StubExtractor: extractor.StubExtractor,
      GroqExtractor: extractor.GroqExtractor,
    };
  }

  it('returns stubs when GROQ_API_KEY is absent', async () => {
    const s = await selectors();
    expect(s.transcriber).toBeInstanceOf(s.StubTranscriber);
    expect(s.vision).toBeInstanceOf(s.StubVision);
    expect(s.recipeExtractor).toBeInstanceOf(s.StubExtractor);
  });

  it('returns real providers when GROQ_API_KEY is set', async () => {
    const s = await selectors('gsk_test');
    expect(s.transcriber).toBeInstanceOf(s.GroqWhisper);
    expect(s.vision).toBeInstanceOf(s.GroqVision);
    expect(s.recipeExtractor).toBeInstanceOf(s.GroqExtractor);
  });
});
