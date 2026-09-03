import type { FactType, Subject, Tx } from './fact-type.js';

/** A validated+persisted write, or an instructive rejection naming what is wrong/needed. */
export type WriteResult =
  | { ok: true; value: unknown }
  | { ok: false; reason: string; missing?: string[]; closest?: string[] };

/**
 * The single write chokepoint: validate → normalize → persist a fact value to its domain table
 * through the fact's type. A `derived` type rejects any write (its `validate` returns read-only).
 * Returns the normalized value on success, or the type's instructive rejection (reason + missing/
 * closest) — the only signal a caller relays to the model.
 *
 * @param factType - The fact's type (owns validation, normalization, persistence).
 * @param subject - The household or member the value belongs to.
 * @param value - The raw value the model supplied.
 * @param tx - The turn's transaction executor (used by tx-backed persists; repo-backed types
 *   manage their own transaction via the repository they were wired with).
 */
export async function writeFact(factType: FactType, subject: Subject, value: unknown, tx: Tx): Promise<WriteResult> {
  const verdict = factType.validate(value);
  if (!verdict.ok) return verdict;
  const normalized = factType.normalize(value);
  // A persist can throw on a grounding miss (FoodPreferenceType: "no catalog match") or a bad domain write.
  // The chokepoint converts that into an instructive rejection so one bad value doesn't propagate
  // through update_tasks into agent.generate and collapse the whole turn to an empty plan.
  try {
    await factType.persist(subject, value, tx);
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
  return { ok: true, value: normalized };
}
