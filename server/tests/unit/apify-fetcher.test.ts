import { describe, it, expect } from 'vitest';
import { StubApifyFetcher, selectSourceFetcher } from '../../src/fetch/apify-fetcher.js';

describe('selectSourceFetcher', () => {
  it('falls back to the stub when APIFY_TOKEN is unset (test env)', () => {
    expect(selectSourceFetcher()).toBeInstanceOf(StubApifyFetcher);
  });
});
