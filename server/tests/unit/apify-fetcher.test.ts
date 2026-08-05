import { describe, it, expect, afterEach, vi } from 'vitest';
import { StubApifyFetcher, selectSourceFetcher } from '../../src/fetch/apify-fetcher.js';

describe('selectSourceFetcher', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('falls back to the stub when no fetch keys are set (test env)', () => {
    expect(selectSourceFetcher()).toBeInstanceOf(StubApifyFetcher);
  });

  it('uses HikerFetcher for Instagram when HIKER_API_KEY is set', async () => {
    vi.resetModules();
    vi.stubEnv('HIKER_API_KEY', 'hk_test');
    const mod = await import('../../src/fetch/apify-fetcher.js');
    expect(mod.selectSourceFetcher()).toBeInstanceOf(mod.HikerFetcher);
  });
});
