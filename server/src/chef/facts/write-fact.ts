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
  // A persist can throw on a grounding miss (DirectiveType: "no catalog match") or a bad domain write.
  // The chokepoint converts that into an instructive rejection so one bad value doesn't propagate
  // through tasks__update into agent.generate and collapse the whole turn to an empty plan.
  try {
    await factType.persist(subject, value, tx);
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
  return { ok: true, value: normalized };
}

/**
 * The retraction counterpart to `writeFact`: remove a value from a collection fact (allergens,
 * diets, food_preferences, …) or clear a scalar, through the fact's type. A type without `retract`
 * can't be removed — that's an instructive rejection, not a crash. Removing an absent value is an
 * idempotent no-op reported as `{ ok: true }` with a note, so a correction never breaks the turn.
 *
 * @param value - The raw value identifying what to remove (grounded by the type, like `persist`).
 */
export async function retractFact(factType: FactType, subject: Subject, value: unknown, tx: Tx): Promise<WriteResult> {
  if (!factType.retract) return { ok: false, reason: `${factType.name} can't be removed — set a new value instead` };
  try {
    const removed = await factType.retract(subject, value, tx);
    return { ok: true, value: removed ? value : `(nothing to remove)` };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
