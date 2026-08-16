import type { SourceType } from "./schema.js";

/** What the pipeline needs to import a job: the resolved source + its owner.
 * Serializable only (crosses the queue and workflow/step boundaries). */
export interface ImportInput {
  jobId: string;
  userId: string;
  sourceType: SourceType;
  sourceRef: string;
  /** Proof-only: inject a one-shot fault into a named step to exercise
   * resume-not-restart. Never set by real intake. */
  faultStep?: "extract";
}

/** Machine error codes a failed job records (matches the import_jobs enum). */
export type ImportErrorCode =
  | "NO_RECIPE"
  | "FETCH_FAILED"
  | "EXTRACTION_FAILED"
  | "MEDIA_UNAVAILABLE"
  | "UNSUPPORTED";

/** The error code for a thrown value. A class instance (e.g. FatalError) can't
 * cross a step boundary, so the pipeline carries the code as a string on the
 * error message; anything unrecognized is EXTRACTION_FAILED. */
export function importErrorCode(err: unknown): ImportErrorCode {
  const message = err instanceof Error ? err.message : String(err);
  const codes: ImportErrorCode[] = [
    "NO_RECIPE",
    "FETCH_FAILED",
    "EXTRACTION_FAILED",
    "MEDIA_UNAVAILABLE",
    "UNSUPPORTED",
  ];
  return codes.find((code) => message.includes(code)) ?? "EXTRACTION_FAILED";
}
