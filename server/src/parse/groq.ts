/**
 * One POST to Groq with retry on rate limits. Groq's vision model has a low
 * tokens-per-minute cap, so a burst of frames/slides gets 429s; without this a
 * rate-limited slide would be dropped (fewer recipes) or fail the import. Retries
 * honor the `retry-after` header (seconds), falling back to capped exponential
 * backoff, then return the last response for the caller to handle.
 */

const RETRYABLE = new Set([429, 503]);
const MAX_ATTEMPTS = 8;

export async function groqFetch(url: string, init: RequestInit): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, init);
    if (!RETRYABLE.has(res.status) || attempt >= MAX_ATTEMPTS) return res;
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs(res, attempt)));
  }
}

/** How long to wait before a retry: the `retry-after` seconds, else backoff. */
function retryDelayMs(res: Response, attempt: number): number {
  const retryAfter = Number(res.headers.get('retry-after'));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return retryAfter * 1000 + 250;
  return Math.min(2 ** attempt * 500, 20000);
}
