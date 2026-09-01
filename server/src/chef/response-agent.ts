import { Agent } from '@mastra/core/agent';
import type { OpenAICompatibleConfig } from '@mastra/core/llm';
import { z } from 'zod';
import { CHEF_TAPBACK_KINDS, type ChatEvent, type ChatEvents, type ReplyPlan, type TapbackKind } from './types.js';

// ponytail: mirrors REASONING_MODEL. Thinking off (DeepSeek thinks by default → slow/empty JSON).
const RESPONSE_MODEL = 'deepseek/deepseek-v4-flash';
const DEEPSEEK_URL = 'https://api.deepseek.com';
const THINKING_OFF = { deepseek: { thinking: { type: 'disabled' } } } as const;

const CHEF_VOICE =
  'You are the Chef, a warm, brief home-cooking companion texting over iMessage. Say each thing the ' +
  'plan asks for in your own voice — rephrase and split freely into short bubbles (one thought per ' +
  'bubble), but never add, drop, or soften a fact, and surface every must_say line in full. ' +
  // Emoji style (chef-tapback-emoji-style.md): emoji are tone, not decoration.
  'Emoji are tone, not decoration: at most one per message, usually none, and only when it matches ' +
  'the words (a light 🎉/🙌/🍳 at a genuine moment). Never a string of emoji, and never 😂/😭/🙂. ' +
  'Return your reply as a list of short text bubbles.';

/**
 * The response half of the Chef. `render` turns a `ReplyPlan` into iMessage `ChatEvents`
 * (text bubbles + tapbacks) in the chef's voice; the real path is a Mastra agent, the test
 * path a scripted responder (no network). Never touches Harvest data — its only effect is the
 * appended events. A fresh `ChatEvents` collector per call, so a reused instance never leaks a
 * prior turn's bubbles (reset-reused-instances, `docs/harvest-principles.md`).
 */
export interface Responder {
  /** @param triggerExternalId - the platform id of the message this turn answers — the only target a
   *   tapback can safely ground on. Absent (null) ⇒ no tapback is emitted; the plan renders as text. */
  render(plan: ReplyPlan, transcriptWindow: string[], triggerExternalId?: string | null): Promise<ChatEvents>;
}

/** The acknowledge intent a tapback stands in for. A plan of only these AND a resolvable target
 *  reacts instead of replying; a `confirm` states a fact, so it stays text (chef-tapback-emoji-style.md). */
function isAckLike(intent: ReplyPlan['intents'][number]): boolean {
  return intent.kind === 'acknowledge';
}

/** Chef's tapback kind for an ack/appreciation — a warm heart by default. Structurally confined to
 *  CHEF_TAPBACK_KINDS (love/laugh/emphasize), so like/dislike can never be emitted (not just a prompt
 *  rule — a compile-time-bounded set). */
function chefTapbackKind(): TapbackKind {
  return CHEF_TAPBACK_KINDS[0]; // 'love' — the safe cross-generational affirmation
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
  async render(plan: ReplyPlan, _transcriptWindow: string[], _triggerExternalId?: string | null): Promise<ChatEvents> {
    const events: ChatEvents = [];
    for (const intent of plan.intents) {
      if (intent.kind === 'acknowledge' && plan.address) {
        events.push({ kind: 'tapback', target: plan.address, emoji: chefTapbackKind() });
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

  async render(plan: ReplyPlan, transcriptWindow: string[], triggerExternalId?: string | null): Promise<ChatEvents> {
    // React (don't reply) when the reasoner addressed a message (plan.address set) with a pure
    // acknowledgment/appreciation AND we hold a REAL target to react on — the trigger's platform id.
    // GROUNDING: we never react on plan.address itself (a model string, possibly hallucinated); the
    // target is always the turn's real trigger id. No resolvable id, a question, or a fact to state
    // ⇒ fall through to the text render below.
    if (plan.address && triggerExternalId && plan.must_say.length === 0 && plan.intents.length > 0 && plan.intents.every(isAckLike)) {
      return [{ kind: 'tapback', target: triggerExternalId, emoji: chefTapbackKind() }];
    }
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
