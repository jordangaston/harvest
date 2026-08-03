import type { SourceType } from '../db/schema/enums.js';

/**
 * The input a parse provider receives: the resolved source (from O-01) plus the
 * owning job/user. Kept minimal in WI-03 — real providers (WI-04/WI-05) read
 * more off the job row.
 */
export interface ParseInput {
  jobId: string;
  userId: string;
  sourceType: SourceType;
  sourceRef: string;
}

/**
 * A terminal parse result (O-08). `ready` carries the persisted `recipeId`;
 * `failed` carries a machine `errorCode` (e.g. NO_RECIPE, MEDIA_UNAVAILABLE).
 * This is the only shape the workflow needs to write a terminal status (AC-6).
 */
export type ParseOutcome =
  | { outcome: 'ready'; recipeId: string }
  | { outcome: 'failed'; errorCode: string };

/** A pluggable parser: resolved source → terminal outcome. Real fetch/extract
 * providers are injected in WI-04/WI-05; WI-03 ships only the stub. */
export type ParseProvider = (input: ParseInput) => Promise<ParseOutcome>;

/**
 * The default provider: a documented sentinel returning `failed` + NO_RECIPE so
 * the workflow shape, transactional transitions, and polling are exercised end-
 * to-end without implying any real parsing. WI-04/WI-05 replace it via
 * `setParseProvider`.
 */
export const stubParseProvider: ParseProvider = async () => ({
  outcome: 'failed',
  errorCode: 'NO_RECIPE',
});

/**
 * Module-level provider seam. The registered DBOS step reads `getParseProvider`
 * inside its body (never captured at registration), so a test can swap the
 * provider and the running workflow picks it up. Reset with `resetParseProvider`.
 */
let current: ParseProvider = stubParseProvider;

/** Installs a parse provider (tests / later tickets). */
export function setParseProvider(provider: ParseProvider): void {
  current = provider;
}

/** Restores the default sentinel stub. */
export function resetParseProvider(): void {
  current = stubParseProvider;
}

/** Returns the active provider — call this *inside* the step body. */
export function getParseProvider(): ParseProvider {
  return current;
}
