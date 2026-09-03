import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import type { OpenAICompatibleConfig } from '@mastra/core/llm';
import { z } from 'zod';
import {
  CHEF_TAPBACK_KINDS,
  DeliberationResultSchema,
  type ChatEvent,
  type ChatEvents,
  type DeliberationResult,
  type TapbackKind,
} from './types.js';

// ponytail: mirrors REASONING_MODEL. Thinking off (DeepSeek thinks by default → slow/empty JSON).
const RESPONSE_MODEL = 'deepseek/deepseek-v4-flash';
const DEEPSEEK_URL = 'https://api.deepseek.com';
const THINKING_OFF = { deepseek: { thinking: { type: 'disabled' } } } as const;
// A turn sends one or two things, sometimes after one deliberate call — a small step cap is plenty.
const MAX_STEPS = 8;

/**
 * One turn's inputs to the responder. `deliberate` is the thunk the model reaches for on a task turn:
 * it runs the reasoner (`reasoner.run`) with the supervisor's question and returns the real
 * `DeliberationResult` (wired by the Chef, so the offline `vi.spyOn(reasoner,'run')` seam holds).
 * `objectiveSummary` is the lean two-line "what/next-step" the model decides against.
 */
export interface SupervisorTurn {
  transcriptWindow: string[];
  objectiveSummary: string;
  /** The platform id of the message this turn answers — the only target a tapback can ground on.
   *  Null ⇒ a tapback can't be sent; the model sends text instead. */
  triggerExternalId: string | null;
  /** Runs the reasoner's tool loop for the supervisor's question, returning its `DeliberationResult`. */
  deliberate: (question: string) => Promise<DeliberationResult>;
}

/**
 * The responder — the front line and the only voice of the Chef. `respond` runs ONE agentic
 * generation: the model reads the newest message against the objective and acts by calling tools —
 * `send` (every outbound: text, tapback, richlink) and `deliberate` (runs the reasoner for an
 * objective-bearing message, then the model voices the result with `send`). A social message is a
 * `send` with no `deliberate`; a task message is `deliberate` then `send`. Its only effect is the
 * events the `send` tool collected — it never touches Harvest data.
 */
export interface Responder {
  respond(turn: SupervisorTurn): Promise<ChatEvents>;
}

/** The `send` tool's input — one tool for every outbound kind. `text` sends a message; `tapback`
 *  reacts to the triggering message; `richlink` shares a URL. (Threaded replies and cards join here
 *  later.) */
const SendInput = z.object({
  type: z.enum(['text', 'tapback', 'richlink']),
  text: z.string().optional(),
  url: z.string().optional(),
  emoji: z.enum(CHEF_TAPBACK_KINDS).optional(),
});
type SendPayload = z.infer<typeof SendInput>;

// The Chef's whole prompt: WHEN to tapback vs reply vs deliberate, and the voice. The model acts only
// by calling tools; the `send`-vs-`deliberate` decision (bias-to-deliberate) is the load-bearing
// correctness property, carried here. Emoji style: chef-tapback-emoji-style.md (tone, not decoration).
const CHEF_PROMPT = [
  'You are the Chef — a warm, brief home-cooking companion texting a household over iMessage.',
  '',
  'You act ONLY by calling tools. Never write prose in your answer — everything the household sees, you',
  'send with the `send` tool. Read the newest message against the objective summary and do ONE of:',
  '',
  '- It bears on the objective in ANY way — an allergy, a preference, an answer, a request, anything to',
  '  capture or to move the objective forward — or you are unsure: call `deliberate` once, then `send`',
  '  the result. Convey every `communicate` point and ask every `ask` question, warmly and briefly.',
  '  Bias hard toward deliberating — a dropped request is far worse than one extra deliberation.',
  '- It needs no reply and a reply would not make the moment better (pure enthusiasm, a thanks): `send`',
  '  a tapback.',
  '- A short warm reply WOULD make the conversation flow: `send` one warm line — no deliberation.',
  '',
  'Voice: a warm friend who cooks, not an assistant. Text-message cadence, contractions, no corporate',
  'or chatbot filler. Keep it to one or two short messages — never a paragraph, markdown, headers, or a',
  'wall of text. Use emoji as tone, at most one per message, usually none; never 😂, 😭, or 🙂.',
  '',
  'When you send the result of a deliberation, preserve every fact exactly as given in meaning — if an',
  'allergy is severe, say it is severe. Never add, drop, soften, or invent a fact, and never echo the',
  "user's own words back at them.",
].join('\n');

/** Chef's default tapback — a warm heart. Structurally confined to CHEF_TAPBACK_KINDS
 *  (love/laugh/emphasize), so like/dislike can never be sent (compile-bounded, not just a prompt rule). */
function defaultTapback(): TapbackKind {
  return CHEF_TAPBACK_KINDS[0]; // 'love' — the safe cross-generational affirmation
}

/**
 * One `send` payload → its `ChatEvent`, grounding a tapback on the turn's REAL trigger id (never a
 * model-supplied target). Returns null when the payload can't ground: a `tapback` with no trigger, or
 * a `text`/`richlink` missing its content — the caller drops it rather than send something bogus.
 */
export function sendEvent(p: SendPayload, triggerExternalId: string | null): ChatEvent | null {
  switch (p.type) {
    case 'text':
      return p.text ? { kind: 'text', text: p.text } : null;
    case 'richlink':
      return p.url ? { kind: 'richlink', url: p.url } : null;
    case 'tapback':
      return triggerExternalId ? { kind: 'tapback', target: triggerExternalId, emoji: p.emoji ?? defaultTapback() } : null;
  }
}

/** The decide/act prompt: the objective summary + the recent transcript to act on. */
function actPrompt(turn: SupervisorTurn): string {
  return [
    `Objective summary:\n${turn.objectiveSummary}`,
    turn.transcriptWindow.length ? `Recent messages:\n${turn.transcriptWindow.join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Test double: no network. Scripted to either `deliberate` (calls the reasoner via `turn.deliberate`,
 * so `vi.spyOn(reasoner,'run')` asserts delegation offline) and/or emit a fixed list of `send`
 * payloads. With `deliberate` and no explicit `send`, it voices the result — one text bubble per
 * `communicate` line and `ask` question, then each artifact as a richlink. Default: deliberate + voice
 * (mirrors the old reasoner→render for the offline suite). Voice quality is a rubric eval, not here.
 */
export class ScriptedResponder implements Responder {
  constructor(private readonly script: { deliberate?: boolean; send?: SendPayload[] } = { deliberate: true }) {}

  async respond(turn: SupervisorTurn): Promise<ChatEvents> {
    let result: DeliberationResult | null = null;
    if (this.script.deliberate) result = await turn.deliberate('advance the objective');

    const events: ChatEvents = [];
    if (this.script.send) {
      for (const p of this.script.send) {
        const e = sendEvent(p, turn.triggerExternalId);
        if (e) events.push(e);
      }
      return events;
    }
    if (result) {
      for (const line of result.communicate) events.push({ kind: 'text', text: line });
      for (const question of result.ask) events.push({ kind: 'text', text: question });
      for (const a of result.artifacts ?? []) events.push({ kind: 'richlink', url: a.url });
    }
    return events;
  }
}

/**
 * The live responder: a Mastra `Agent` (thinking-off) that runs ONE tool-loop generation. Its tools
 * are `send` (collects each outbound `ChatEvent`) and `deliberate` (runs the reasoner and returns its
 * `DeliberationResult` to the model to voice). No structured output — the model's `send` calls ARE the
 * reply, so there is no structured-output-vs-tool-call two-pass. The collected events are the result.
 */
export class MastraResponder implements Responder {
  constructor(private readonly apiKey: string) {}

  static create(apiKey: string): MastraResponder {
    return new MastraResponder(apiKey);
  }

  async respond(turn: SupervisorTurn): Promise<ChatEvents> {
    const model: OpenAICompatibleConfig = { id: RESPONSE_MODEL, url: DEEPSEEK_URL, apiKey: this.apiKey };
    const events: ChatEvents = [];

    const send = createTool({
      id: 'send',
      description:
        'Send something to the household. type="text" with `text` for a message; type="tapback" to ' +
        'react to their last message with a warm heart; type="richlink" with `url` to share a recipe ' +
        'link. Call once per thing you send (usually just once).',
      inputSchema: SendInput,
      execute: async (payload: SendPayload) => {
        const e = sendEvent(payload, turn.triggerExternalId);
        if (e) events.push(e);
        return { sent: e !== null };
      },
    });

    const deliberate = createTool({
      id: 'deliberate',
      description:
        'Deliberate on how to advance the objective for a message that bears on it — an allergy, a ' +
        'preference, an answer, a request. Pass a short `question` (e.g. "how do I advance the ' +
        'objective?" or "does Alex like spicy food?"). Persists what the household said and returns ' +
        'what to `communicate` and `ask`. Call once for any objective-bearing or uncertain message.',
      inputSchema: z.object({ question: z.string() }),
      outputSchema: DeliberationResultSchema,
      execute: async ({ question }: { question: string }) => turn.deliberate(question),
    });

    const agent = new Agent({
      id: 'chef',
      name: 'chef',
      instructions: CHEF_PROMPT,
      model,
      tools: { send, deliberate },
    });
    await agent.generate(actPrompt(turn), {
      providerOptions: THINKING_OFF,
      stopWhen: ({ steps }: { steps: unknown[] }) => steps.length >= MAX_STEPS,
    });
    return events;
  }
}

/**
 * The responder for the current env: the live Mastra agent when `DEEPSEEK_API_KEY` is set, else the
 * offline scripted stub. Tests pass their own `ScriptedResponder`; this selector is the env gate.
 */
export function selectResponseAgent(): Responder {
  if (process.env.DEEPSEEK_API_KEY) return MastraResponder.create(process.env.DEEPSEEK_API_KEY);
  return new ScriptedResponder();
}
