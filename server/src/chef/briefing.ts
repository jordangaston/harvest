import type { Objective } from '../models/objective.js';
import type { Task } from '../models/task.js';
import { objectiveDefinition, taskGuidance } from './objectives/index.js';

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
  tasks: Task[];
  members: BriefingMember[];
  transcript: TranscriptLine[];
  trigger: string;
  /** Objectives sitting suspended under the active one — a one-line inventory in L1. */
  suspended?: string[];
  /** When the trigger is a threaded reply, a snippet of the parent message it answers. */
  replyingTo?: string;
}

const HARD_RULE =
  'HARD RULE: never write a value the tools did not return. If a value has no catalog match, ' +
  'acknowledge it and move on — never confirm or guess it.';

const CONDUCT_AND_SAFETY =
  'You are the reasoning half of a private chef onboarding a household over text. Decide what must ' +
  'happen and what must be said — you emit no prose (the response half owns voice). Change the world ' +
  'only by calling tools. After the room confirms they cook together, call create_household FIRST. ' +
  'Fill the objective tasks below with update_tasks, addressing each by its [id]: batch every task you ' +
  'can answer this turn into one call, except a task marked (solo), which must be sent by itself. ' +
  'Record a fact the household volunteers that no task is asking for with update_facts by its key. ' +
  'Discover a fact type\'s legal values, or ground a loose phrase to a canonical value, with fact_types ' +
  'before filling — never write a value the tools did not return. ' +
  // React-vs-reply (chef-tapback-emoji-style.md): a tapback is the low-friction "I saw / I like that".
  'REACT vs REPLY: when a message just needs acknowledgment or appreciation and carries no content to ' +
  'answer (a low-stakes answer, a "here you go", a bit of enthusiasm), acknowledge it with a tapback — ' +
  'emit a single acknowledge intent and set replyPlan.address to that message. Reply with text when the ' +
  'user expects real content (a question, a request), and say a plain "got it" as a short warm TEXT ' +
  '("Sounds good!"), never a tapback. React sparingly — not every message. ' +
  'In replyPlan.intents, ask for the next eligible task(s) — never repeat a question already answered, ' +
  'and never echo the user back. Task status is set by the tools you call, not by the reply plan. ' +
  HARD_RULE;

/**
 * Assembles the reasoning agent's prompt from the loaded turn state — a pure function, no network,
 * no model call. Conduct + safety, the active objective and its UNFILLED slots, members, the
 * condition-gated guidance, the transcript, and the framed trigger.
 * @throws If the objective's `definition` is not registered.
 */
export function prepareBriefing(input: BriefingInput): string {
  const def = objectiveDefinition(input.objective.definition);
  if (!def) throw new Error(`No definition registered for objective '${input.objective.definition}'`);

  // Each task is shown with its row id (uuid PK) — the model addresses that id in update_tasks, so two
  // members' same-named tasks (both `allergens`) stay distinct. Member tasks name whose they are.
  const nameByUser = new Map(input.members.map((m) => [m.userId, m.name]));
  const guidance = taskGuidance();
  const unfilled = input.tasks
    .map((t) => {
      const who = t.memberUserId ? ` for ${nameByUser.get(t.memberUserId) ?? 'member'}` : '';
      const label = t.fact ?? (t.kind === 'emit' ? 'deliver the close' : t.kind);
      const marks = [t.solo ? ' (solo)' : '', t.afterTaskIds.length ? ' (gated)' : ''].join('');
      const how = t.fact ? guidance.get(t.fact) : undefined;
      return `- [${t.id}] ${label}${who}${marks} (${t.status})${how ? `\n    ↳ ${how}` : ''}`;
    })
    .join('\n');
  const members = input.members.map((m) => `- ${m.name} (${m.handle}) — member_user_id: ${m.userId}`).join('\n');
  const transcript = input.transcript.map((l) => `${l.role}: ${l.text}`).join('\n');

  return [
    `# Conduct\n${CONDUCT_AND_SAFETY}`,
    `# Objective: ${def.id}\n${def.instructions}`,
    input.suspended?.length ? `Suspended underneath: ${input.suspended.join(', ')}` : '',
    `# Tasks in play (address by [id] with update_tasks; each with how to fill it)\n${unfilled || '(none)'}`,
    `# Household\n${members}`,
    `# Recent transcript\n${transcript}`,
    `# What just arrived\n${input.replyingTo ? `↳ replying to: "${input.replyingTo}"\n` : ''}${input.trigger}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}
