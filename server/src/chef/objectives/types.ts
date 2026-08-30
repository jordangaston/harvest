/** One condition-gated L2 guidance pair: inject `then` only while `when` holds (design §L2). */
export interface Guidance {
  when: string;
  then: string;
}

/**
 * A goal the Chef can pursue, registered in code and keyed by the objective row's
 * `definition` string. `tools` is the RESIDENT set (resolved into the prompt for focus,
 * not a boundary — the rest stay searchable and `canRun` enforces legality). `guidance`
 * is the L2 body, condition-gated.
 */
export interface ObjectiveDefinition {
  id: string;
  instructions: string;
  tools: string[];
  guidance: Guidance[];
}
