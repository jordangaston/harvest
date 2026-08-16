/**
 * Compat harness for the existing e2e suite against the migrated Vercel stack.
 *
 * The e2e tests were written for Fastify — `buildApp()` + `app.inject(...)` +
 * `initDbos`/`shutdownDbos`/`terminateOcr`/`pool`. The migrated stack is a live
 * `vercel dev` process (Hono + Nitro + Vercel Queue + Workflow + Turso), so this
 * module re-creates that surface over HTTP: `buildApp().inject()` fetches the dev
 * server and returns a Fastify-shaped `{ statusCode, json() }` where `json()` is
 * synchronous (the body is pre-read), matching the tests' `res.json().auth...`.
 *
 * The dev server itself is booted once per suite by the vitest global setup
 * (global-setup.ts); this module only talks to it.
 */

/** The running `vercel dev` base URL (set by the global setup). */
export const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

interface InjectOptions {
  method: string;
  url: string;
  payload?: unknown;
  headers?: Record<string, string>;
}

/** A Fastify-`inject`-shaped response: `statusCode` + a synchronous `json()`. */
interface InjectResponse {
  statusCode: number;
  json: () => any;
}

/** The Fastify-`app`-shaped surface the tests drive: `.inject()` and a no-op `.close()`. */
export interface AppCompat {
  inject: (opts: InjectOptions) => Promise<InjectResponse>;
  close: () => Promise<void>;
}

/**
 * Build the compat app. Returns an object whose `.inject()` issues one HTTP call
 * to the live dev server and buffers the JSON body so callers can read `.json()`
 * synchronously — exactly the shape the Fastify tests expect.
 */
export function buildApp(): AppCompat {
  return {
    async inject({ method, url, payload, headers }: InjectOptions): Promise<InjectResponse> {
      const res = await fetch(`${BASE_URL}${url}`, {
        method,
        headers: { "content-type": "application/json", ...headers },
        body: payload !== undefined ? JSON.stringify(payload) : undefined,
      });
      // Pre-read the body so the tests can call res.json() synchronously.
      const text = await res.text();
      if (res.status >= 400) console.error(`[inject] ${method} ${url} -> ${res.status}: ${text.slice(0, 300)}`);
      const body = text.length ? JSON.parse(text) : undefined;
      return { statusCode: res.status, json: () => body };
    },
    async close(): Promise<void> {
      /* the dev server is torn down by the global setup, not per-app */
    },
  };
}

// Lifecycle shims — the migrated stack has no DBOS/pg/OCR-worker to bootstrap or
// tear down (Turso is per-request; OCR runs inside the workflow). The tests still
// call these in beforeAll/afterAll, so they resolve to no-ops.

/** No-op: the migrated stack has no DBOS runtime to start. */
export async function initDbos(): Promise<void> {}
/** No-op: the migrated stack has no DBOS runtime to stop. */
export async function shutdownDbos(): Promise<void> {}
/** No-op: OCR (tesseract.js) is spun up and torn down inside each workflow run. */
export async function terminateOcr(): Promise<void> {}
/** No-op pg pool shim: Turso opens a client per request; nothing to close. */
export const pool = { end: async (): Promise<void> => {} };

// The latency-check tests import the fetchers directly (pure network readers, no
// DB), so re-export them from the migrated stack at the path the tests expect.
export { YouTubeFetcher } from "../../../src/fetch/youtube-fetcher.js";
export { PinterestFetcher } from "../../../src/fetch/pinterest-fetcher.js";
