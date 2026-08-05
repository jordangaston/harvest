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
const { fetchWebsite, persist, extract } = vi.hoisted(() => ({
  fetchWebsite: vi.fn(),
  persist: vi.fn(),
  extract: vi.fn(),
}));
vi.mock('../../src/fetch/website.js', () => ({
  selectWebsiteFetcher: () => ({ fetch: fetchWebsite }),
}));
vi.mock('../../src/repositories/recipe-repository.js', () => ({
  RecipeRepository: { create: () => ({ persist }) },
}));
// The extractor spy asserts the Tier-0 path never calls it.
vi.mock('../../src/parse/extractor.js', () => ({ selectExtractor: () => ({ extract }) }));

import { ImportPipeline, ImportError, type ImportInput } from '../../src/pipeline/import-pipeline.js';

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

    const recipeId = await ImportPipeline.run(INPUT);

    expect(recipeId).toBe('recipe-1');
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
