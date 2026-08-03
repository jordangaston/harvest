import { describe, it, expect } from 'vitest';
import { StubApifyFetcher, selectSourceFetcher } from '../../src/fetch/apify-fetcher.js';

describe('StubApifyFetcher', () => {
  it('returns the TikTok fixture with caption, video, thumbnail and outbound link', async () => {
    const post = await new StubApifyFetcher().fetchPost('tiktok', 'https://tiktok.com/x');
    expect(post).toEqual(StubApifyFetcher.FIXTURES.tiktok);
    expect(post.videoUrl).toBeDefined();
    expect(post.outboundLink).toContain('iamneverfull.com');
  });

  it('returns a Pinterest fixture with an outbound link and no video', async () => {
    const post = await new StubApifyFetcher().fetchPost('pinterest', 'https://pinterest.com/pin/1');
    expect(post.outboundLink).toContain('theferventmama.com');
    expect(post.videoUrl).toBeUndefined();
  });
});

describe('selectSourceFetcher', () => {
  it('falls back to the stub when APIFY_TOKEN is unset (test env)', () => {
    expect(selectSourceFetcher()).toBeInstanceOf(StubApifyFetcher);
  });
});
