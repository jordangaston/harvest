import { verifySpectrumSignature } from '@spectrum-ts/core/webhook';

/**
 * Verifies a native Spectrum webhook signature over the exact raw bytes. A thin pass
 * to the SDK's constant-time verifier — the HMAC (and its freshness check) is never
 * hand-rolled. Header `X-Spectrum-Signature: v0=<hex>` = HMAC-SHA256(secret, "v0:" +
 * X-Spectrum-Timestamp + ":" + rawBody).
 * @param headers - Request headers, keys lowercased.
 * @param rawBody - The exact bytes received (never a re-encoded body).
 * @param now - Epoch millis; inject in tests so the freshness check passes for a fixed fixture.
 * @returns True when the signature verifies and is fresh.
 */
export async function verifyWebhook(
  headers: Record<string, string>,
  rawBody: Uint8Array,
  secret: string,
  now?: number,
): Promise<boolean> {
  const result = await verifySpectrumSignature({ headers, rawBody, secret, now });
  return result.ok;
}
