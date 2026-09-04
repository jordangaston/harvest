import type { Objective } from '../models/objective.js';
import type { Task } from '../models/task.js';
import { objectiveDefinition, taskGuidance } from './objectives/index.js';

/** One turn's transcript entry (role + text), for tone and to avoid repetition. A household line
 *  carries a short `[m#]` handle the `send` tool can target a tapback at, and the speaker's `name`
 *  (the member who sent it) so the model can tell members apart — `undefined` when not yet known. */
export interface TranscriptLine {
  role: 'household' | 'chef';
  text: string;
  handle?: string;
  name?: string;
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

/**
 * Assembles the turn's STATE prompt (the agent's user message) — a pure function, no network, no
 * model call. Conduct, voice, and rules live in the system prompt (`CHEF_PROMPT`); this carries only
 * what changes turn to turn: the active objective and its UNFILLED slots, members, the condition-gated
 * fill guidance, and the tagged new messages.
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
  // The tagged batch is the new messages; fall back to the raw trigger text if there is no transcript.
  // A household line is labelled with its speaker's name (or "unknown"), so the model never conflates
  // who said what; a chef line stays "chef".
  const speaker = (l: TranscriptLine): string => (l.role === 'chef' ? 'chef' : l.name ?? 'unknown');
  const conversation = input.transcript.map((l) => `${l.handle ? `[${l.handle}] ` : ''}${speaker(l)}: ${l.text}`).join('\n') || input.trigger;
  const replyingLine = input.replyingTo ? `↳ replying to: "${input.replyingTo}"\n` : '';

  return [
    `<objective name="${def.id}">\n${def.instructions}\n</objective>`,
    input.suspended?.length ? `<suspended>${input.suspended.join(', ')}</suspended>` : '',
    `<tasks>\n${unfilled || '(none)'}\n</tasks>`,
    `<household>\n${members}\n</household>`,
    `<conversation>\n${replyingLine}${conversation}\n</conversation>`,
  ]
    .filter(Boolean)
    .join('\n\n');
}
