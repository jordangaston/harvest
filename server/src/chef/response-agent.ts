import { Agent } from '@mastra/core/agent';
import type { OpenAICompatibleConfig } from '@mastra/core/llm';
import { z } from 'zod';
import type { ChatEvent, ChatEvents, ReplyPlan } from './types.js';

// ponytail: mirrors REASONING_MODEL. Thinking off (DeepSeek thinks by default → slow/empty JSON).
const RESPONSE_MODEL = 'deepseek/deepseek-v4-flash';
const DEEPSEEK_URL = 'https://api.deepseek.com';
const THINKING_OFF = { deepseek: { thinking: { type: 'disabled' } } } as const;

const CHEF_VOICE =
  'You are the Chef, a warm, brief home-cooking companion texting over iMessage. Say each thing the ' +
  'plan asks for in your own voice — rephrase and split freely into short bubbles (one thought per ' +
  'bubble), but never add, drop, or soften a fact, and surface every must_say line in full. Return ' +
  'your reply as a list of short text bubbles.';

/**
 * The response half of the Chef. `render` turns a `ReplyPlan` into iMessage `ChatEvents`
 * (text bubbles + tapbacks) in the chef's voice; the real path is a Mastra agent, the test
 * path a scripted responder (no network). Never touches Harvest data — its only effect is the
 * appended events. A fresh `ChatEvents` collector per call, so a reused instance never leaks a
 * prior turn's bubbles (reset-reused-instances, `docs/harvest-principles.md`).
 */
export interface Responder {
  render(plan: ReplyPlan, transcriptWindow: string[]): Promise<ChatEvents>;
}

/** Flattens a ReplyPlan + transcript window into one prompt string for the response agent. */
function renderPrompt(plan: ReplyPlan, transcriptWindow: string[]): string {
  return [
    transcriptWindow.length ? `Recent messages:\n${transcriptWindow.join('\n')}` : '',
    `Convey these, in order:\n${JSON.stringify(plan.intents)}`,
    plan.must_say.length ? `Say every one of these in full:\n${plan.must_say.join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Test double: deterministically renders a ReplyPlan into ChatEvents with no network — one text
 * bubble per intent (a react intent becomes a tapback when the plan `address`es a message guid),
 * then each `must_say` as its own bubble. Voice quality is a WI-08 rubric eval, not tested here.
 */
export class ScriptedResponder implements Responder {
  async render(plan: ReplyPlan, _transcriptWindow: string[]): Promise<ChatEvents> {
    const events: ChatEvents = [];
    for (const intent of plan.intents) {
      if (intent.kind === 'acknowledge' && plan.address) {
        events.push({ kind: 'tapback', target: plan.address, emoji: 'like' });
      } else {
        events.push({ kind: 'text', text: intentText(intent) });
      }
    }
    for (const line of plan.must_say) events.push({ kind: 'text', text: line });
    return events;
  }
}

/** The conveyable text of one intent (the fact/question/note the response voices). */
function intentText(intent: ReplyPlan['intents'][number]): string {
  switch (intent.kind) {
    case 'ask':
      return intent.question;
    case 'confirm':
      return intent.fact;
    default:
      return intent.note;
  }
}

/**
 * The live response agent: a cheap Mastra `Agent` that voices a `ReplyPlan` as short iMessage text
 * bubbles via `structuredOutput` (jsonPromptInjection — DeepSeek rejects the json_schema response
 * format). Text-only: the sender delivers only text this increment, so the consumer skips non-text
 * events anyway.
 */
export class MastraResponder implements Responder {
  constructor(private readonly apiKey: string) {}

  static create(apiKey: string): MastraResponder {
    return new MastraResponder(apiKey);
  }

  async render(plan: ReplyPlan, transcriptWindow: string[]): Promise<ChatEvents> {
    const model: OpenAICompatibleConfig = { id: RESPONSE_MODEL, url: DEEPSEEK_URL, apiKey: this.apiKey };
    const agent = new Agent({ id: 'chef-response', name: 'chef-response', instructions: CHEF_VOICE, model });
    const res = await agent.generate(renderPrompt(plan, transcriptWindow), {
      structuredOutput: { schema: z.object({ bubbles: z.array(z.string().min(1)).min(1) }), jsonPromptInjection: true },
      providerOptions: THINKING_OFF,
    });
    const { bubbles } = (res as { object: { bubbles: string[] } }).object;
    return bubbles.map((text): ChatEvent => ({ kind: 'text', text }));
  }
}

/**
 * The responder for the current env: the live Mastra agent when `DEEPSEEK_API_KEY` is set, else the
 * offline scripted stub. Mirrors `selectReasoningAgent` / `selectExtractor`. Tests pass their own
 * `ScriptedResponder`; this selector is the deploy-time env gate.
 */
export function selectResponseAgent(): Responder {
  if (process.env.DEEPSEEK_API_KEY) return MastraResponder.create(process.env.DEEPSEEK_API_KEY);
  return new ScriptedResponder();
}
