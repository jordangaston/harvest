/** One condition-gated L2 guidance pair: inject `then` only while `when` holds (design §L2). */
export interface Guidance {
  when: string;
  then: string;
}

/**
 * One slot the objective declares. A household-scoped slot is instantiated once when the
 * objective is seeded; a member-scoped one (`scope: 'member'`) is instantiated per member as
 * each is identified (the concrete `member_user_id` is not known at definition time). This is
 * the definition's static shape — the persisted `SlotSpec` (objective-store) adds the resolved
 * `memberUserId`.
 */
export interface DefinitionSlot {
  key: string;
  scope: 'household' | 'member';
  required: boolean;
}

/**
 * A goal the Chef can pursue, registered in code and keyed by the objective row's
 * `definition` string. `tools` is the RESIDENT set (resolved into the prompt for focus,
 * not a boundary — the rest stay searchable and `canRun` enforces legality). `guidance`
 * is the L2 body, condition-gated. `slots` declares what must be filled — it names
 * requirements, never a conversational path (no step list, no cursor).
 */
export interface ObjectiveDefinition {
  id: string;
  instructions: string;
  tools: string[];
  guidance: Guidance[];
  slots: DefinitionSlot[];
}
