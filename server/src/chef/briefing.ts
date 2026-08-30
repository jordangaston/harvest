import type { Objective } from '../models/objective.js';
import type { Slot } from '../models/slot.js';
import { objectiveDefinition, type ObjectiveDefinition } from './objectives/index.js';
import { TOOL_REGISTRY, type ToolEntry } from './tools/registry.js';
import type { ChefState } from './tools/types.js';

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
 * The loaded turn state `prepareBriefing` assembles from. Superset of `ChefState` (which
 * `canRun` reads) — carries the objective + unfilled slots, members with names, the transcript
 * window, and the framed trigger (the pending inbound past the cursor). WI-06 finalizes loading.
 */
export interface BriefingInput {
  state: ChefState;
  objective: Objective;
  slots: Slot[];
  members: BriefingMember[];
  transcript: TranscriptLine[];
  trigger: string;
  /** Objectives sitting suspended under the active one — a one-line inventory in L1. */
  suspended?: string[];
}

/** What the agent generates against: the assembled prompt, the resident tools, the request context. */
export interface Briefing {
  prompt: string;
  residentTools: ToolEntry[];
  requestContext: { chefState: ChefState };
}

const HARD_RULE =
  'HARD RULE: never write a value the tools did not return. If a value has no catalog match, ' +
  'acknowledge it and move on — never confirm or guess it.';

const CONDUCT_AND_SAFETY =
  'You are the reasoning half of a private chef. Decide what must happen and what must be said; ' +
  'you emit no prose (the response half owns voice). Change the world only through command tools. ' +
  'Search for a tool when you need a capability you do not have. ' +
  HARD_RULE;

/** The active objective's resident tools = its declared set ∩ `canRun(state)`, resolved per turn. */
export function residentTools(def: ObjectiveDefinition, state: ChefState): ToolEntry[] {
  return def.tools
    .map((id) => TOOL_REGISTRY[id])
    .filter((e): e is ToolEntry => !!e && e.canRun(state));
}

/** L2: only the guidance whose condition holds this turn (design §L2). */
function activeGuidance(def: ObjectiveDefinition): string {
  return def.guidance.map((g) => `When ${g.when}: ${g.then}`).join('\n');
}

/**
 * Assembles the reasoning agent's L1/L2/L3 context and resident tool set from the loaded state —
 * a pure function, no network, no model call. L1: conduct+safety, the active objective and its
 * UNFILLED slots, members, transcript, resident tools, the framed trigger. L2: the objective's
 * condition-gated guidance. L3: search_catalog + the hard rule (tool search is wired on the agent).
 * @throws If the objective's `definition` is not registered.
 */
export function prepareBriefing(input: BriefingInput): Briefing {
  const def = objectiveDefinition(input.objective.definition);
  if (!def) throw new Error(`No definition registered for objective '${input.objective.definition}'`);

  const resident = residentTools(def, input.state);
  const unfilled = input.slots.map((s) => `- ${s.key} (${s.status})`).join('\n');
  const members = input.members.map((m) => `- ${m.name} (${m.handle})`).join('\n');
  const transcript = input.transcript.map((l) => `${l.role}: ${l.text}`).join('\n');

  const prompt = [
    `# Conduct\n${CONDUCT_AND_SAFETY}`,
    `# Objective: ${def.id}\n${def.instructions}`,
    input.suspended?.length ? `Suspended underneath: ${input.suspended.join(', ')}` : '',
    `# Slots still needed\n${unfilled || '(none)'}`,
    `# Household\n${members}`,
    `# Guidance\n${activeGuidance(def)}`,
    `# Recent transcript\n${transcript}`,
    `# What just arrived\n${input.trigger}`,
    `# Resident tools\n${resident.map((e) => e.id).join(', ')}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  return { prompt, residentTools: resident, requestContext: { chefState: input.state } };
}
