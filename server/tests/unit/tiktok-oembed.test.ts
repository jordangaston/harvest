import { describe, it, expect } from 'vitest';
import { StubTikTokOembed } from '../../src/fetch/tiktok-oembed.js';

describe('StubTikTokOembed', () => {
  it('returns the fixed caption + thumbnail payload without network', async () => {
    const result = await new StubTikTokOembed().fetch('https://www.tiktok.com/@x/video/1');
    expect(result).toEqual(StubTikTokOembed.PAYLOAD);
    expect(result?.caption).toContain('Teriyaki');
    expect(result?.thumbnailUrl).toMatch(/^https:\/\//);
  });
});
