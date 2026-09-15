import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAdvancedClient, mintSharedToken } from '../src/imessage/advanced-client.js';

describe('advanced-client', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('mintSharedToken returns the token and authenticates with Basic base64(id:secret)', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ succeed: true, data: { type: 'shared', token: 'T', expiresIn: 900 } })),
    );

    const { token } = await mintSharedToken('pid', 'sec');

    expect(token).toBe('T');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://spectrum.photon.codes/projects/pid/imessage/tokens');
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from('pid:sec').toString('base64')}`,
    );
  });

  it('createAdvancedClient throws naming the missing env var, before any network call', () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    vi.stubEnv('PHOTON_PROJECT_ID', 'pid');
    vi.stubEnv('PHOTON_PROJECT_SECRET', '');

    expect(() => createAdvancedClient()).toThrow('PHOTON_PROJECT_SECRET');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
