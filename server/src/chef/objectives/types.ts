/**
 * A goal the Chef can pursue, registered in code and keyed by the objective row's
 * `definition` string. `tools` is the RESIDENT set (resolved into the prompt for focus,
 * not a boundary — the rest stay searchable and `canRun` enforces legality). Its tasks are
 * declared separately (see `householdTaskSpecs`/`memberTaskSpecs`), seeded onto the thread as
 * rows; the definition names requirements, never a conversational path (no step list, no cursor).
 */
export interface ObjectiveDefinition {
  id: string;
  instructions: string;
  tools: string[];
}
