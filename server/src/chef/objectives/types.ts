/**
 * One slot the objective declares. A household-scoped slot is instantiated once when the
 * objective is seeded; a member-scoped one (`scope: 'member'`) is instantiated per member as
 * each is identified (the concrete `member_user_id` is not known at definition time). This is
 * the definition's static shape — the persisted `SlotSpec` (objective-repository) adds the resolved
 * `memberUserId`.
 */
export interface DefinitionSlot {
  key: string;
  scope: 'household' | 'member';
  required: boolean;
  /** How to fill this slot — shown beside it in the briefing while it is unfilled (design §L2). */
  guidance?: string;
}

/**
 * A goal the Chef can pursue, registered in code and keyed by the objective row's
 * `definition` string. `tools` is the RESIDENT set (resolved into the prompt for focus,
 * not a boundary — the rest stay searchable and `canRun` enforces legality). `slots`
 * declares what must be filled — each carrying its own fill guidance — and names
 * requirements, never a conversational path (no step list, no cursor).
 */
export interface ObjectiveDefinition {
  id: string;
  instructions: string;
  tools: string[];
  slots: DefinitionSlot[];
}
