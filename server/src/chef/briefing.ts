import type { Objective } from '../models/objective.js';
import type { Task } from '../models/task.js';
import { objectiveDefinition, taskGuidance } from './objectives/index.js';

/** WIP limit: how many of the eligible tasks to surface in the prompt at once. The rest stay tracked
 *  and surface as earlier ones complete — keeps the model focused instead of chewing the whole backlog. */
const TASK_WINDOW = 4;

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
  /** WI-02 heartbeat: this is a proactive follow-up (no inbound) on the named tasks — a one-line
   *  instruction to nudge the quiet asks / ask the eligible unasked ones among them. */
  heartbeat?: { taskIds: string[] };
  /** Meal-reminders WI-01: this is a scheduled reminder turn — announce the named course and its
   *  planned recipes (resolved by the consumer under the lock). Folded as one instruction line. */
  reminder?: { meal: string; recipes: { title: string; url?: string }[] };
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

  // Each task is shown with its row id (uuid PK) — the model addresses that id in tasks__update, so two
  // members' same-named tasks (both `allergens`) stay distinct. Member tasks name whose they are.
  const nameByUser = new Map(input.members.map((m) => [m.userId, m.name]));
  const guidance = taskGuidance();
  // Window to a WIP limit: only the next few tasks go in the prompt, not the whole backlog — a wall of
  // tasks is context the model must chew through, and most of it is not actionable this turn. The rest
  // stay tracked; a "…" tells the model more are queued. ponytail: `input.tasks` is already the eligible
  // ready-set (loadActive drops terminal tasks and any whose `afterTaskIds` aren't done), so their order
  // is seed order and slicing from the top is enough — no topo sort is needed while that gate holds.
  const shown = input.tasks.slice(0, TASK_WINDOW);
  const hidden = input.tasks.length - shown.length;
  const unfilled = shown
    .map((t) => {
      const who = t.memberUserId ? ` for ${nameByUser.get(t.memberUserId) ?? 'member'}` : '';
      const label = t.fact ?? (t.kind === 'emit' ? 'deliver the close' : t.kind);
      const marks = [t.solo ? ' (solo)' : '', t.afterTaskIds.length ? ' (gated)' : ''].join('');
      const how = t.fact ? guidance.get(t.fact) : undefined;
      return `- [${t.id}] ${label}${who}${marks} (${t.status})${how ? `\n    ↳ ${how}` : ''}`;
    })
    .join('\n');
  const moreLine = hidden > 0 ? `\n- … (${hidden} more queued; fill these first)` : '';
  const members = input.members.map((m) => `- ${m.name} (${m.handle}) — member_user_id: ${m.userId}`).join('\n');
  // The tagged batch is the new messages; fall back to the raw trigger text if there is no transcript.
  // A household line is labelled with its speaker's name (or "unknown"), so the model never conflates
  // who said what; a chef line stays "chef".
  const speaker = (l: TranscriptLine): string => (l.role === 'chef' ? 'chef' : l.name ?? 'unknown');
  const conversation = input.transcript.map((l) => `${l.handle ? `[${l.handle}] ` : ''}${speaker(l)}: ${l.text}`).join('\n') || input.trigger;
  const replyingLine = input.replyingTo ? `↳ replying to: "${input.replyingTo}"\n` : '';
  // A heartbeat turn has no inbound to answer — this line tells the model why it woke and which tasks
  // to advance (nudge the quiet asks, ask the eligible unasked ones), so it re-engages the household
  // rather than treating the silence as nothing to do.
  const heartbeatLine = input.heartbeat?.taskIds.length
    ? `<heartbeat>\nThe household has gone quiet. Follow up now on these task ids: ${input.heartbeat.taskIds.join(', ')}. Nudge the ones already asked, ask the ones not yet asked, and deliver any that emit content (then mark them done) — one warm, natural message, no pressure.\n</heartbeat>`
    : '';
  // A reminder turn has no inbound and no tasks — this line names the course to announce and its
  // planned recipes (title + card url), so the model sends the heads-up and shares each card.
  const reminderLine = input.reminder
    ? `<reminder>\nScheduled ${input.reminder.meal} reminder — announce tonight's ${input.reminder.meal} to the household and share each recipe card. Planned:\n${input.reminder.recipes.map((r) => `- ${r.title}${r.url ? ` — ${r.url}` : ''}`).join('\n')}\n</reminder>`
    : '';

  return [
    `<objective name="${def.id}">\n${def.instructions}\n</objective>`,
    input.suspended?.length ? `<suspended>${input.suspended.join(', ')}</suspended>` : '',
    `<tasks>\n${unfilled || '(none)'}${moreLine}\n</tasks>`,
    `<household>\n${members}\n</household>`,
    heartbeatLine,
    reminderLine,
    `<conversation>\n${replyingLine}${conversation}\n</conversation>`,
  ]
    .filter(Boolean)
    .join('\n\n');
}
