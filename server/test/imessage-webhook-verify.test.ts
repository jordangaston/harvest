import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verifyWebhook } from "../src/imessage/webhook-verify.js";

// Test Case 1: HMAC verification. Build the fixture signature exactly as the SDK
// specifies — v0=HMAC-SHA256(secret, "v0:" + timestamp + ":" + rawBody) — and inject
// `now` so the freshness check passes for a fixed timestamp.

const SECRET = "whsec_test";
const TS_SECONDS = 1_700_000_000;
const NOW = TS_SECONDS * 1000;
const RAW = new TextEncoder().encode('{"event":"message.new","message":{"id":"m1"}}');

function sign(rawBody: Uint8Array, secret: string): Record<string, string> {
  const base = Buffer.concat([Buffer.from(`v0:${TS_SECONDS}:`), Buffer.from(rawBody)]);
  const hex = createHmac("sha256", secret).update(base).digest("hex");
  return {
    "x-spectrum-signature": `v0=${hex}`,
    "x-spectrum-timestamp": String(TS_SECONDS),
  };
}

describe("verifyWebhook", () => {
  it("accepts a correctly signed body", async () => {
    expect(await verifyWebhook(sign(RAW, SECRET), RAW, SECRET, NOW)).toBe(true);
  });

  it("rejects a tampered body", async () => {
    const tampered = new TextEncoder().encode('{"event":"message.new","message":{"id":"m2"}}');
    expect(await verifyWebhook(sign(RAW, SECRET), tampered, SECRET, NOW)).toBe(false);
  });

  it("rejects the wrong secret", async () => {
    expect(await verifyWebhook(sign(RAW, "whsec_other"), RAW, SECRET, NOW)).toBe(false);
  });

  it("rejects a missing signature header", async () => {
    expect(await verifyWebhook({ "x-spectrum-timestamp": String(TS_SECONDS) }, RAW, SECRET, NOW)).toBe(false);
  });
});
