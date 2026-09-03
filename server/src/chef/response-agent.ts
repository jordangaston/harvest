import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import type { OpenAICompatibleConfig } from '@mastra/core/llm';
import { z } from 'zod';
import {
  CHEF_TAPBACK_KINDS,
  DeliberationResultSchema,
  isEmptyDeliberation,
  type ChatEvent,
  type ChatEvents,
  type DeliberationResult,
  type TapbackKind,
} from './types.js';

// ponytail: mirrors REASONING_MODEL. Thinking off (DeepSeek thinks by default → slow/empty JSON).
const RESPONSE_MODEL = 'deepseek/deepseek-v4-flash';
const DEEPSEEK_URL = 'https://api.deepseek.com';
const THINKING_OFF = { deepseek: { thinking: { type: 'disabled' } } } as const;

/**
 * One turn's inputs to the responder supervisor. `deliberate` is the thunk the supervisor reaches for
 * on a task turn — it calls `reasoner.run(input, ctx, db)` and returns the real `DeliberationResult`
 * (wired by the Chef, so the offline `vi.spyOn(reasoner,'run')` seam holds without a model).
 * `objectiveSummary` is the lean two-line "what/next-step" the supervisor decides against.
 */
export interface SupervisorTurn {
  transcriptWindow: string[];
  objectiveSummary: string;
  /** The platform id of the message this turn answers — the only target a tapback can ground on.
   *  Null ⇒ a social react degrades to a text bubble (AC-7). */
  triggerExternalId: string | null;
  /** Runs the reasoner's tool loop and returns its `DeliberationResult` (task turns only). */
  deliberate: () => Promise<DeliberationResult>;
}

/**
 * The responder supervisor — the front line of the two-agent Chef. `respond` runs the turn: it
 * decides social vs task; a social turn is voiced directly (a tapback or ≤2 short bubbles) and the
 * reasoner is never invoked; a task turn calls `deliberate` (which runs the reasoner) then renders
 * the returned `DeliberationResult`. The real path is a Mastra agent; the test path a scripted
 * supervisor (no network). Its only effect is the returned events — never touches Harvest data.
 */
export interface Responder {
  respond(turn: SupervisorTurn): Promise<ChatEvents>;
}

// The responder is the VOICE of the two-agent Chef: the reasoner (reasoning-agent.ts) decides the
// facts, the responder phrases them. Every rule here preserves the DeliberationResult verbatim in
// meaning — the responder never adds or drops a fact. It phrases in as FEW messages as possible.
const CHEF_VOICE = [
  'You are the Chef — a warm, brief home-cooking companion texting a household over iMessage. A',
  'reasoning partner has already decided what is true and what must be said this turn and handed you a',
  'result. You never decide facts, ask new questions, or add information — you only phrase the result,',
  'warmly and briefly, the way a real person texts.',
  '',
  'The result gives you a list of things to communicate (facts to confirm, things to acknowledge, the',
  'upshot of deep thinking) and a list of questions to ask. Your whole job is to say all of it —',
  'nothing more, nothing less — in as FEW messages as possible.',
  '',
  'How to phrase a turn:',
  '1. Read every communicate line and every ask question in the result.',
  '2. Say each one in your own warm, plain words — text-message cadence, contractions, no corporate or',
  '   chatbot filler.',
  '3. Fold everything into a SINGLE message whenever you can — your acknowledgment, any fact you are',
  '   confirming, and your question belong in one natural text, not spread across separate bubbles.',
  '   Only send a second message when a single one would be genuinely hard to read in a glance.',
  '4. Say every communicate line in full and plainly — never drop it, shorten it, or reword away its',
  '   meaning. If it says an allergy is severe, you say it is severe.',
  '5. Return your reply as a list of messages — usually just one.',
  '',
  'Always:',
  '- Prefer a single message: combine acknowledgment + fact + question into one warm, compact text.',
  '- Keep it short and skimmable — a sentence or two, never a paragraph or a wall of text.',
  '- Preserve every communicate line and question exactly as given in meaning.',
  '- Sound like a warm friend who cooks, not an assistant. Concise, genuine, easy.',
  '- Use emoji as tone, not decoration: at most one per message, usually none, and only when it truly',
  '  matches the words — a light 🎉, 🙌, or 🍳 at a genuine moment.',
  '',
  'Never:',
  '- Never add a fact, detail, number, or suggestion the result did not give you.',
  '- Never drop or skip anything the result asks you to communicate or ask.',
  '- Never soften, hedge, downplay, or qualify a fact the result states — say it as plainly as it does.',
  "- Never ask a question the result did not hand you, and never echo the user's own words back at them.",
  '- Never split your reply into multiple bubbles when one message would do.',
  '- Never write a long paragraph, a monologue, or markdown/headers/bullets — only words you would text.',
  '- Never use a string of emoji, and never use 😂, 😭, or 🙂.',
  '',
  'Example —',
  'communicate: "peanuts are a severe allergy for Sam"; ask: "which grocery store do you usually shop at?"',
  'Your reply is one message — return it as {"bubbles":[...]} with a single string:',
  '{"bubbles":["Got it — noting peanuts as a severe allergy for Sam. Which grocery store do you usually shop at?"]}',
].join('\n');

// The supervisor's decide instructions: is this a task-bearing message (call deliberate) or purely
// social (voice directly)? Bias to delegate — a dropped request is worse than an extra reasoner run
// (AC-3). This is the load-bearing correctness property, carried here.
const SUPERVISOR_DECIDE = [
  'You are the Chef, a warm home-cooking companion texting a household over iMessage. Read the newest',
  'message against the objective summary below and decide ONE thing: does it bear on the objective —',
  'an allergy, a preference, an answer to a question, a request, anything that should update the',
  "household's profile or move the objective forward? Or is it purely social — enthusiasm, a thanks, a",
  'reaction with no content to capture?',
  '',
  'If it bears on the objective in ANY way, or you are unsure, call the `deliberate` tool. Bias hard',
  'toward deliberating: a dropped request is far worse than one extra deliberation. Call it exactly',
  'once. If it is purely social, do NOT call deliberate — just acknowledge warmly and briefly.',
].join('\n');

/** Chef's tapback kind for an ack/appreciation — a warm heart by default. Structurally confined to
 *  CHEF_TAPBACK_KINDS (love/laugh/emphasize), so like/dislike can never be emitted (compile-bounded). */
function chefTapbackKind(): TapbackKind {
  return CHEF_TAPBACK_KINDS[0]; // 'love' — the safe cross-generational affirmation
}

/** Flattens a DeliberationResult + transcript window into one render-prompt string. */
function renderPrompt(result: DeliberationResult, transcriptWindow: string[]): string {
  return [
    transcriptWindow.length ? `Recent messages:\n${transcriptWindow.join('\n')}` : '',
    result.communicate.length ? `Communicate these, in order:\n${result.communicate.join('\n')}` : '',
    result.ask.length ? `Ask these:\n${result.ask.join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** The artifacts of a DeliberationResult as their deterministic send events (richlink → richlink). */
function artifactEvents(result: DeliberationResult): ChatEvents {
  return (result.artifacts ?? []).map((a): ChatEvent => ({ kind: 'richlink', url: a.url }));
}

/**
 * Test double: no network. A social turn (deliberate NOT flagged) reacts with a `love` tapback on a
 * real trigger id, else a single text bubble (AC-7). A task turn calls `deliberate` once and renders
 * its result — one text bubble per communicate line and ask question, in order, then each artifact as
 * a richlink. The social-vs-task choice is the injectable `social` flag so `vi.spyOn(reasoner,'run')`
 * asserts delegation offline. Voice quality is a WI-08 rubric eval, not tested here.
 */
export class ScriptedResponder implements Responder {
  /** @param social - when true, this turn is treated as social (no deliberation); default task. */
  constructor(private readonly social = false) {}

  async respond(turn: SupervisorTurn): Promise<ChatEvents> {
    if (this.social) return socialEvents(turn.triggerExternalId);
    const result = await turn.deliberate();
    if (isEmptyDeliberation(result)) return [];
    const events: ChatEvents = [];
    for (const line of result.communicate) events.push({ kind: 'text', text: line });
    for (const question of result.ask) events.push({ kind: 'text', text: question });
    events.push(...artifactEvents(result));
    return events;
  }
}

/** A social reply: a grounded `love` tapback when a real trigger id exists, else a short text bubble
 *  (AC-7 — never a tapback with no real target). */
function socialEvents(triggerExternalId: string | null): ChatEvents {
  if (triggerExternalId) return [{ kind: 'tapback', target: triggerExternalId, emoji: chefTapbackKind() }];
  return [{ kind: 'text', text: 'love it!' }];
}

/**
 * The live responder supervisor: a Mastra `Agent` (thinking-off). A task turn is two generations —
 * (gen-1) a tool-enabled decide pass that may call the `deliberate` createTool (its execute runs the
 * reasoner and returns the real `DeliberationResult`); (gen-2) a tool-free `structuredOutput:{bubbles}`
 * render pass over that result. A social turn skips both the reasoner and gen-1's delegation: it
 * voices directly. Empty deliberation short-circuits to `[]` before the render call (AC-4).
 */
export class MastraResponder implements Responder {
  constructor(private readonly apiKey: string) {}

  static create(apiKey: string): MastraResponder {
    return new MastraResponder(apiKey);
  }

  async respond(turn: SupervisorTurn): Promise<ChatEvents> {
    const model: OpenAICompatibleConfig = { id: RESPONSE_MODEL, url: DEEPSEEK_URL, apiKey: this.apiKey };

    // gen-1: decide social vs task. A tool-enabled pass whose only tool is `deliberate`; if the
    // supervisor calls it, we hold the real DeliberationResult (captured out of the closure).
    let result: DeliberationResult | null = null;
    const deliberateTool = createTool({
      id: 'deliberate',
      description:
        'Deliberate on how to advance the objective for a message that bears on it — an allergy, a ' +
        'preference, an answer, a request. Persists what the household said and returns what to say back. ' +
        'Call this once for any objective-bearing or uncertain message; skip it only for purely social lines.',
      inputSchema: z.object({}),
      outputSchema: DeliberationResultSchema,
      execute: async () => {
        result = await turn.deliberate();
        return result;
      },
    });
    const decider = new Agent({
      id: 'chef-supervisor',
      name: 'chef-supervisor',
      instructions: SUPERVISOR_DECIDE,
      model,
      tools: { deliberate: deliberateTool },
    });
    await decider.generate(decidePrompt(turn), { providerOptions: THINKING_OFF });

    // Social turn: no deliberation happened → voice directly (AC-1, AC-7).
    if (!result) return socialEvents(turn.triggerExternalId);
    // Empty deliberation degrades cleanly — no bubble forced (AC-4).
    if (isEmptyDeliberation(result)) return [];

    // gen-2: render the DeliberationResult as short bubbles (tool-free structuredOutput). Artifacts
    // render deterministically alongside — never paraphrased out of prose.
    const voice = new Agent({ id: 'chef-response', name: 'chef-response', instructions: CHEF_VOICE, model });
    const res = await voice.generate(renderPrompt(result, turn.transcriptWindow), {
      structuredOutput: { schema: z.object({ bubbles: z.array(z.string().min(1)).min(1) }), jsonPromptInjection: true },
      providerOptions: THINKING_OFF,
    });
    const { bubbles } = (res as { object: { bubbles: string[] } }).object;
    return [...bubbles.map((text): ChatEvent => ({ kind: 'text', text })), ...artifactEvents(result)];
  }
}

/** The decide-pass prompt: the objective summary + the newest transcript to judge social vs task. */
function decidePrompt(turn: SupervisorTurn): string {
  return [
    `Objective summary:\n${turn.objectiveSummary}`,
    turn.transcriptWindow.length ? `Recent messages:\n${turn.transcriptWindow.join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * The responder for the current env: the live Mastra agent when `DEEPSEEK_API_KEY` is set, else the
 * offline scripted stub. Tests pass their own `ScriptedResponder`; this selector is the env gate.
 */
export function selectResponseAgent(): Responder {
  if (process.env.DEEPSEEK_API_KEY) return MastraResponder.create(process.env.DEEPSEEK_API_KEY);
  return new ScriptedResponder();
}
