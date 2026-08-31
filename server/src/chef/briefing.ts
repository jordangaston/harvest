import type { Objective } from '../models/objective.js';
import type { Slot } from '../models/slot.js';
import { objectiveDefinition, type ObjectiveDefinition } from './objectives/index.js';

/** One turn's transcript entry (role + text), for tone and to avoid repetition. */
export interface TranscriptLine {
  role: 'household' | 'chef';
  text: string;
}

/** A household member as the briefing names them (never invents a value the tools didn't return). */
export interface BriefingMember {
  userId: string;
  name: string;
  handle: string;
}

/**
 * The loaded turn state `prepareBriefing` assembles the prompt from: the active objective + its
 * UNFILLED slots, members with names, the transcript window, and the framed trigger (the pending
 * inbound past the cursor). The tools the model may call are advertised by Mastra, not the prompt.
 */
export interface BriefingInput {
  objective: Objective;
  slots: Slot[];
  members: BriefingMember[];
  transcript: TranscriptLine[];
  trigger: string;
  /** Objectives sitting suspended under the active one — a one-line inventory in L1. */
  suspended?: string[];
}

const HARD_RULE =
  'HARD RULE: never write a value the tools did not return. If a value has no catalog match, ' +
  'acknowledge it and move on — never confirm or guess it.';

const CONDUCT_AND_SAFETY =
  'You are the reasoning half of a private chef onboarding a household over text. Decide what must ' +
  'happen and what must be said — you emit no prose (the response half owns voice). Change the world ' +
  'only by calling tools. After the room confirms they cook together, call create_household FIRST, ' +
  'before any member save. Whenever an answer belongs in a household preference (stores, budget, ' +
  'shopping day, equipment, headcount, leftovers, weekly meal counts, cook days, per-meal time) call ' +
  'save_household_profile that same turn; the household\'s cooking goals go through save_household_goals. ' +
  "A member's allergens/diets/likes/dislikes/skill go through save_member_profile — an allergen only " +
  'counts with confirmed:true and a severity, and a like/dislike must be grounded with search_catalog ' +
  '(kind:"taste") to a facet+value before saving. In replyPlan.intents, ask for the next unfilled slot(s) — never ' +
  'repeat a question already answered, and never echo the user back. In slotUpdates, mark the slots ' +
  'this turn answered — reference each slot by the [id] shown in "Slots still needed" — as filled ' +
  '(with the value) or asked. ' +
  HARD_RULE;

/** L2: only the guidance whose condition holds this turn (design §L2). */
function activeGuidance(def: ObjectiveDefinition): string {
  return def.guidance.map((g) => `When ${g.when}: ${g.then}`).join('\n');
}

/**
 * Assembles the reasoning agent's prompt from the loaded turn state — a pure function, no network,
 * no model call. Conduct + safety, the active objective and its UNFILLED slots, members, the
 * condition-gated guidance, the transcript, and the framed trigger.
 * @throws If the objective's `definition` is not registered.
 */
export function prepareBriefing(input: BriefingInput): string {
  const def = objectiveDefinition(input.objective.definition);
  if (!def) throw new Error(`No definition registered for objective '${input.objective.definition}'`);

  // Each slot is shown with its row id (uuid PK) — the model returns that id in slotUpdates, so two
  // members' same-named slots (both `allergens`) stay distinct. Member slots name whose they are.
  const nameByUser = new Map(input.members.map((m) => [m.userId, m.name]));
  const unfilled = input.slots
    .map((s) => `- [${s.id}] ${s.key}${s.memberUserId ? ` for ${nameByUser.get(s.memberUserId) ?? 'member'}` : ''} (${s.status})`)
    .join('\n');
  const members = input.members.map((m) => `- ${m.name} (${m.handle}) — member_user_id: ${m.userId}`).join('\n');
  const transcript = input.transcript.map((l) => `${l.role}: ${l.text}`).join('\n');

  return [
    `# Conduct\n${CONDUCT_AND_SAFETY}`,
    `# Objective: ${def.id}\n${def.instructions}`,
    input.suspended?.length ? `Suspended underneath: ${input.suspended.join(', ')}` : '',
    `# Slots still needed\n${unfilled || '(none)'}`,
    `# Household\n${members}`,
    `# Guidance\n${activeGuidance(def)}`,
    `# Recent transcript\n${transcript}`,
    `# What just arrived\n${input.trigger}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}
