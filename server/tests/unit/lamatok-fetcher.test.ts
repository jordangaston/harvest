import { describe, it, expect, afterEach, vi } from 'vitest';
import { selectTikTokFetcher, LamatokFetcher } from '../../src/fetch/lamatok-fetcher.js';

describe('selectTikTokFetcher', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('falls back to caption-only oEmbed when LAMATOK_API_KEY is unset (test env)', () => {
    expect(selectTikTokFetcher()).not.toBeInstanceOf(LamatokFetcher);
  });

  it('uses LamatokFetcher when LAMATOK_API_KEY is set', async () => {
    vi.resetModules();
    vi.stubEnv('LAMATOK_API_KEY', 'lt_test');
    const mod = await import('../../src/fetch/lamatok-fetcher.js');
    expect(mod.selectTikTokFetcher()).toBeInstanceOf(mod.LamatokFetcher);
  });
});
