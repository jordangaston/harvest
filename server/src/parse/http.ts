/**
 * One POST to an LLM API with retry on rate limits. A burst of extract/ASR calls
 * can get 429s; without this a rate-limited call would fail the import. Retries
 * honor the `retry-after` header (seconds), falling back to capped exponential
 * backoff, then return the last response for the caller to handle. Ported verbatim
 * from server/src/parse/http.ts.
 */

const RETRYABLE = new Set([429, 503]);
const MAX_ATTEMPTS = 5;

export async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, init);
    if (!RETRYABLE.has(res.status) || attempt >= MAX_ATTEMPTS) return res;
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs(res, attempt)));
  }
}

/** Seconds from the `retry-after` header, or 0 when absent/unparseable. */
export function retryAfterSeconds(res: Response): number {
  const retryAfter = Number(res.headers.get("retry-after"));
  return Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 0;
}

/** How long to wait before a retry: the `retry-after` seconds, else backoff. */
function retryDelayMs(res: Response, attempt: number): number {
  const seconds = retryAfterSeconds(res);
  if (seconds > 0) return seconds * 1000 + 250;
  return Math.min(2 ** attempt * 500, 8000);
}
