import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import type { OpenAICompatibleConfig } from '@mastra/core/llm';
import { z } from 'zod';
import { TAPBACK_EMOJIS, type ChatEvent, type ChatEvents, type ReplyPlan } from './types.js';

// ponytail: swap the id if DeepSeek renames it. Q-2-1 = cheap-for-response half; mirrors REASONING_MODEL.
const RESPONSE_MODEL = 'deepseek/deepseek-v4-flash';
const DEEPSEEK_URL = 'https://api.deepseek.com';

const CHEF_VOICE =
  'You are the Chef, a warm, brief home-cooking companion texting over iMessage. Say each thing the ' +
  'plan asks for in your own voice — rephrase and split freely into short bubbles (one thought per ' +
  'bubble), but never add, drop, or soften a fact, and surface every must_say line in full. Use ' +
  'react_with_tapback only to acknowledge a specific inbound message; otherwise respond_with_text.';

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

/** Builds the two message-emitting tools closed over one turn's `events` collector. */
function emitTools(events: ChatEvents) {
  const respond_with_text = createTool({
    id: 'respond_with_text',
    description: 'Send one iMessage text bubble. Call once per bubble; short is better.',
    inputSchema: z.object({ text: z.string().min(1).max(1000) }),
    execute: async ({ text }) => {
      events.push({ kind: 'text', text });
    },
  });
  const react_with_tapback = createTool({
    id: 'react_with_tapback',
    description: 'React to a specific inbound message with a tapback, by its message guid.',
    inputSchema: z.object({ target: z.string(), emoji: z.enum(TAPBACK_EMOJIS) }),
    execute: async ({ target, emoji }) => {
      events.push({ kind: 'tapback', target, emoji });
    },
  });
  return { respond_with_text, react_with_tapback };
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
 * The live response agent: a cheap Mastra `Agent` whose message-emitting tools are rebuilt per
 * `render` closed over a fresh collector, so it renders straight into that turn's events. Runs no
 * `structuredOutput` — its output *is* its tool-call side effects. Dormant until WI-06 wires it.
 */
export class MastraResponder implements Responder {
  constructor(private readonly apiKey: string) {}

  static create(apiKey: string): MastraResponder {
    return new MastraResponder(apiKey);
  }

  async render(plan: ReplyPlan, transcriptWindow: string[]): Promise<ChatEvents> {
    const events: ChatEvents = [];
    const model: OpenAICompatibleConfig = { id: RESPONSE_MODEL, url: DEEPSEEK_URL, apiKey: this.apiKey };
    const agent = new Agent({ id: 'chef-response', name: 'chef-response', instructions: CHEF_VOICE, model, tools: emitTools(events) });
    await agent.generate(renderPrompt(plan, transcriptWindow), {
      stopWhen: ({ steps }: { steps: unknown[] }) => steps.length >= 4,
    });
    return events;
  }
}

/**
 * The responder for the current env: the live Mastra agent when `DEEPSEEK_API_KEY` is set, else
 * the offline scripted stub. Mirrors `selectReasoningAgent` / `selectExtractor`. Tests pass their
 * own `ScriptedResponder`; this selector is the deploy-time env gate.
 */
export function selectResponseAgent(): Responder {
  if (process.env.DEEPSEEK_API_KEY) return MastraResponder.create(process.env.DEEPSEEK_API_KEY);
  return new ScriptedResponder();
}
