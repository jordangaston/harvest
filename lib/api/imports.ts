import { apiFetch, ApiError } from "./client";
import type { ImportJob } from "./types";

const POLL_INTERVAL_MS = 1500;
const POLL_BUDGET_MS = 120_000; // imports (esp. video/carousel) can take minutes; server has no timeout.

// Job error_code meaning "this link has no recipe" vs. a transient failure.
const NO_RECIPE_CODES = new Set(["NO_RECIPE"]);

/** Terminal outcome of an import, already mapped to the app's two error buckets. */
export type ImportOutcome =
  | { status: "ready"; recipeId: string }
  | { status: "no_recipe" } // → "We don't think this contains a recipe"
  | { status: "failed" }; // → "Oops let's try that again"

async function startImport(url: string): Promise<ImportJob> {
  const { job } = await apiFetch<{ job: ImportJob }>("/v1/imports", {
    method: "POST",
    body: JSON.stringify({ source: { url } }),
  });
  return job;
}

async function getImport(id: string): Promise<ImportJob> {
  const { job } = await apiFetch<{ job: ImportJob }>(`/v1/imports/${id}`);
  return job;
}

/**
 * Runs a full import: POST, then poll until ready/failed or the budget elapses.
 * Maps every failure to `no_recipe` (422/400/NO_RECIPE) or `failed` (everything else).
 * @param url - The link to import.
 * @param onProgress - Optional 0–100 progress callback from the job.
 */
export async function runImport(url: string, onProgress?: (progress: number) => void): Promise<ImportOutcome> {
  let job: ImportJob;
  try {
    job = await startImport(url);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 422 || error.status === 400)) return { status: "no_recipe" };
    return { status: "failed" };
  }

  const deadline = Date.now() + POLL_BUDGET_MS;
  while (Date.now() < deadline) {
    let current: ImportJob;
    try {
      current = await getImport(job.id);
    } catch {
      return { status: "failed" };
    }
    onProgress?.(current.progress);
    if (current.status === "ready" && current.recipe_id) return { status: "ready", recipeId: current.recipe_id };
    if (current.status === "failed") {
      return { status: current.error_code && NO_RECIPE_CODES.has(current.error_code) ? "no_recipe" : "failed" };
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  return { status: "failed" }; // budget elapsed
}
