import type { HouseholdPreferenceRepository } from '../../repositories/household-preference-repository.js';
import type { PreferenceRepository } from '../../repositories/preference-repository.js';
import type { TasteOptionsService } from '../../services/taste-options-service.js';

/**
 * The chef-state slice `canRun` reads (WI-06 finalizes the full shape). `canRun` is a
 * pure function of this — no I/O — so it is unit-testable with no database wired.
 */
export interface ChefState {
  householdId: string;
  members: Array<{ userId: string }>;
  /** The tool's parsed args, present only for a defensive re-check inside `execute`. */
  args?: unknown;
}

/**
 * What a command actually did: the normalized values that landed, and each value the
 * model tried that was refused (unknown enum, unconfirmed allergen, absent member),
 * with the nearest valid ids when they exist. The command log the design audits.
 */
export interface SaveResult {
  saved: Record<string, unknown>;
  rejected: Array<{ input: string; reason: string; closest?: string[] }>;
}

/**
 * The household-scoped receivers a tool's `execute` calls in-process (no HTTP, no
 * tokens — the agent holds no credentials). Assembled once per thread and threaded in
 * as the second `execute` arg alongside the chef state.
 */
export interface ToolCtx {
  state: ChefState;
  householdPrefs: HouseholdPreferenceRepository;
  memberPrefs: PreferenceRepository;
  taste: TasteOptionsService;
}
