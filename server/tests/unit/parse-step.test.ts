import { describe, it, expect, afterEach } from 'vitest';
import {
  getParseProvider,
  setParseProvider,
  resetParseProvider,
  stubParseProvider,
} from '../../src/pipeline/parse-step.js';

const INPUT = { jobId: 'j', userId: 'u', sourceType: 'tiktok' as const, sourceRef: 'https://x/1' };

afterEach(() => resetParseProvider());

describe('parse-step seam', () => {
  it('the default stub returns a NO_RECIPE failed sentinel', async () => {
    expect(await stubParseProvider(INPUT)).toEqual({ outcome: 'failed', errorCode: 'NO_RECIPE' });
  });

  it('setParseProvider swaps the active provider; reset restores the stub', async () => {
    setParseProvider(async () => ({ outcome: 'ready', recipeId: 'r-1' }));
    expect(await getParseProvider()(INPUT)).toEqual({ outcome: 'ready', recipeId: 'r-1' });
    resetParseProvider();
    expect(await getParseProvider()(INPUT)).toEqual({ outcome: 'failed', errorCode: 'NO_RECIPE' });
  });
});
