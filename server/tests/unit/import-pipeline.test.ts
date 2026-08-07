import { describe, it, expect, vi, beforeEach } from 'vitest';

// The DBOS decorators become no-ops so the static steps run as plain functions,
// and the datasource stub keeps the module importable — no runtime, no Postgres.
vi.mock('@dbos-inc/dbos-sdk', () => {
  const passthrough = () => (_t: unknown, _k: unknown, descriptor: unknown) => descriptor;
  return { DBOS: { workflow: passthrough, step: passthrough, startWorkflow: vi.fn() } };
});
vi.mock('@dbos-inc/drizzle-datasource', () => {
  class DrizzleDataSource {
    transaction() {
      return (_t: unknown, _k: unknown, descriptor: unknown) => descriptor;
    }
    static get client() {
      return {};
    }
  }
  return { DrizzleDataSource };
});

// vi.mock factories are hoisted above these consts, so the spies must be too.
const { fetchWebsite, persist, extract, fetchTikTok, transcribe, readFrames, audio, frames } = vi.hoisted(() => ({
  fetchWebsite: vi.fn(),
  persist: vi.fn(),
  extract: vi.fn(),
  fetchTikTok: vi.fn(),
  transcribe: vi.fn(),
  readFrames: vi.fn(),
  audio: vi.fn(),
  frames: vi.fn(),
}));
vi.mock('../../src/fetch/website.js', () => ({
  selectWebsiteFetcher: () => ({ fetch: fetchWebsite }),
}));
vi.mock('../../src/repositories/recipe-repository.js', () => ({
  RecipeRepository: { create: () => ({ persist }) },
}));
// The extractor spy asserts the Tier-0 path never calls it.
vi.mock('../../src/parse/extractor.js', () => ({ selectExtractor: () => ({ extract }) }));
vi.mock('../../src/fetch/lamatok-fetcher.js', () => ({ selectTikTokFetcher: () => ({ fetchPost: fetchTikTok }) }));
vi.mock('../../src/parse/asr.js', () => ({ selectTranscriber: () => ({ transcribe }) }));
vi.mock('../../src/parse/vision.js', () => ({
  selectVision: () => ({ readFrames }),
  selectVisionEscalation: () => ({ readFrames }),
}));
vi.mock('../../src/fetch/media-extractor.js', () => ({
  selectMediaExtractor: () => ({ audio, frames }),
  scaleImage: (b: Buffer) => b,
}));

import {
  ImportPipeline,
  ImportError,
  isSectionLabel,
  stripSectionLabels,
  type ImportInput,
} from '../../src/pipeline/import-pipeline.js';

const INPUT: ImportInput = { jobId: 'j', userId: 'u', sourceType: 'website', sourceRef: 'https://ex.com/r' };

beforeEach(() => {
  vi.clearAllMocks();
  persist.mockResolvedValue('recipe-1');
});

describe('ImportPipeline.run', () => {
  it('persists a website recipe via the Tier-0 structured path, no extractor call', async () => {
    fetchWebsite.mockResolvedValue({
      title: 'Garlic Butter Chicken',
      ingredients: ['2 chicken breasts'],
      steps: ['Sear.'],
    });

    const recipeIds = await ImportPipeline.run(INPUT);

    expect(recipeIds).toEqual(['recipe-1']);
    expect(extract).not.toHaveBeenCalled();
    expect(persist).toHaveBeenCalledOnce();
  });

  it('throws NO_RECIPE when the source yields no title or ingredients', async () => {
    fetchWebsite.mockResolvedValue({ title: '', ingredients: [], steps: [] });

    await expect(ImportPipeline.run(INPUT)).rejects.toThrow(ImportError);
    await expect(ImportPipeline.run(INPUT)).rejects.toMatchObject({ code: 'NO_RECIPE' });
    expect(persist).not.toHaveBeenCalled();
  });
});

describe('stripSectionLabels — drop bare ingredient/step section headers', () => {
  it('flags bare section headers', () => {
    for (const label of ['For the base', 'To finish', 'For the sauce:', 'To garnish', 'the topping:']) {
      expect(isSectionLabel(label), label).toBe(true);
    }
  });

  it('keeps real steps and ingredients (no false positives)', () => {
    for (const real of [
      'To finish, stir in the heavy cream, fresh spinach and Parmesan', // >6 words
      'Season the base with 2 tsp salt', // has a digit
      'Fresh basil to garnish', // "to" not at the start
      'Salt to taste', // not a grouping verb
    ]) {
      expect(isSectionLabel(real), real).toBe(false);
    }
  });

  it('drops headers from a list but keeps the real lines', () => {
    expect(stripSectionLabels(['For the Base', 'Sear the chicken 3 min', 'To Finish'])).toEqual([
      'Sear the chicken 3 min',
    ]);
  });

  it('never empties a non-empty list (a strip that would zero it out is a no-op)', () => {
    expect(stripSectionLabels(['For the base', 'To finish'])).toEqual(['For the base', 'To finish']);
  });
});

describe('ImportPipeline.readSlideRecipe — VLM escalation on a steps-less card', () => {
  const longText = 'ingredient list '.repeat(60); // > CAROUSEL_RECIPE_MIN_CHARS (800)

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })));
  });

  it('re-reads a card that OCRs to ingredients-but-no-steps and recovers the steps', async () => {
    // Primary (Tesseract) read → ingredients only; escalation (VLM) read → full card.
    readFrames.mockResolvedValueOnce(longText).mockResolvedValueOnce(longText + ' method');
    extract
      .mockResolvedValueOnce({ title: 'Card', ingredients: ['pasta'], steps: [], confidence: 0.9 })
      .mockResolvedValueOnce({ title: 'Card', ingredients: ['pasta'], steps: ['Boil 8 min'], confidence: 0.9 });

    const data = await ImportPipeline.readSlideRecipe('https://cdn/slide.jpg');

    expect(readFrames).toHaveBeenCalledTimes(2); // primary + escalation
    expect(data?.steps).toEqual(['Boil 8 min']);
  });

  it('does not escalate when the card already has steps', async () => {
    readFrames.mockResolvedValue(longText);
    extract.mockResolvedValue({ title: 'Card', ingredients: ['pasta'], steps: ['Boil 8 min'], confidence: 0.9 });

    const data = await ImportPipeline.readSlideRecipe('https://cdn/slide.jpg');

    expect(readFrames).toHaveBeenCalledTimes(1); // no escalation
    expect(data?.steps).toEqual(['Boil 8 min']);
  });
});

const TIKTOK: ImportInput = { jobId: 'j', userId: 'u', sourceType: 'tiktok', sourceRef: 'https://tiktok/x' };

describe('ImportPipeline.run — steps-less caption gating', () => {
  it('escalates to the video when a caption yields a recipe with no steps and a video is available', async () => {
    fetchTikTok.mockResolvedValue({ caption: 'ingredients only, method in the video', videoUrl: 'v', videoHeaders: {} });
    // First (caption) extraction is steps-less; second (video) extraction has steps.
    extract
      .mockResolvedValueOnce({ title: 'T', ingredients: ['x'], steps: [], confidence: 0.9 })
      .mockResolvedValueOnce({ title: 'T', ingredients: ['x'], steps: ['Cook 5 min until golden'], confidence: 0.9 });
    audio.mockResolvedValue(Buffer.from(''));
    transcribe.mockResolvedValue('spoken cooking steps');
    frames.mockResolvedValue([]);
    readFrames.mockResolvedValue('on-screen text');

    const recipeIds = await ImportPipeline.run(TIKTOK);

    expect(recipeIds).toEqual(['recipe-1']);
    expect(extract).toHaveBeenCalledTimes(2); // caption, then video escalation
    expect(transcribe).toHaveBeenCalledOnce();
    expect(persist).toHaveBeenCalledOnce();
    expect(persist.mock.calls[0][0].steps).toEqual(['Cook 5 min until golden']);
  });

  it('keeps a steps-less caption recipe when there is no media to escalate to (link in bio)', async () => {
    fetchTikTok.mockResolvedValue({ caption: 'ingredients only — full method at link in bio' });
    extract.mockResolvedValue({ title: 'T', ingredients: ['x'], steps: [], confidence: 0.9 });

    const recipeIds = await ImportPipeline.run(TIKTOK);

    expect(recipeIds).toEqual(['recipe-1']);
    expect(extract).toHaveBeenCalledOnce();
    expect(transcribe).not.toHaveBeenCalled();
    expect(persist).toHaveBeenCalledOnce();
  });
});
