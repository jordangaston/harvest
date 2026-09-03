import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import type { OpenAICompatibleConfig } from '@mastra/core/llm';
import { z } from 'zod';
import type { Database } from '../db.js';
import { prepareBriefing, type BriefingInput } from './briefing.js';
import { objectiveDefinition } from './objectives/index.js';
import { buildTools } from './tools/registry.js';
import type { TurnContext } from './tools/types.js';
import { CHEF_TAPBACK_KINDS, type ChatEvent, type TapbackKind } from './types.js';

// ponytail: swap the id if DeepSeek renames it. Thinking ON at LOW effort — thinking-OFF conflated
// household members; LOW caps the think cost. The knob is verified against @mastra/core's DeepSeek
// provider-options types + DeepSeek API docs (spec WI-4): `thinking.type:'enabled'` + reasoning_effort.
const CHEF_MODEL = 'deepseek/deepseek-v4-flash';
const DEEPSEEK_URL = 'https://api.deepseek.com';
const THINKING_LOW = { deepseek: { thinking: { type: 'enabled' }, reasoningEffort: 'low' } } as const;
// One turn: an ack, a batch of tool fills, then the result bubbles. With thinking ON each step is an
// expensive reasoning call, so keep the cap tight.
const MAX_STEPS = 10;

/** The tools whose use means the turn did real work — it persisted/changed something. Calling any of
 *  these flips the turn's `worked` flag, which gates the consumer's fact-less-task confirm. A pure
 *  read (`read_facts`/`fact_types`) or a `send` does not count. */
const MUTATING_TOOL_IDS = new Set(['update_tasks', 'update_facts', 'create_household', 'import_recipe']);

/**
 * One turn's inputs to the single chef agent. `briefing`/`ctx` build the objective tools and the
 * prompt body; `send` flushes each outbound `ChatEvent` live through the Consumer's sink (journal +
 * send, idempotent). `triggerExternalId` is the only id a tapback can ground on.
 */
export interface ChefTurn {
  briefing: BriefingInput;
  ctx: TurnContext;
  /** The platform id of the message this turn answers — the only target a tapback can ground on.
   *  Null ⇒ a tapback can't be sent; the agent sends text instead. */
  triggerExternalId: string | null;
  /** Flushes one outbound event live, mid-turn (journal + send, idempotent) — the `send` tool's sink. */
  send: (event: ChatEvent) => Promise<void>;
}

/**
 * The whole Chef in one agent. `run` reads the newest message against the objective, calls the
 * objective's tools to persist what the household said, and speaks through `send` — full context on
 * both jobs. Returns whether the turn did real work (any mutating tool ran), which the consumer uses
 * to gate its fact-less-task confirm. No structured output: the `send` calls ARE the reply.
 */
export interface ChefAgent {
  run(turn: ChefTurn, db: Database): Promise<{ worked: boolean }>;
}

/** The `send` tool's input — one tool for every outbound kind. `text` sends a message; `tapback`
 *  reacts to the triggering message; `richlink` shares a URL. */
const SendInput = z.object({
  type: z.enum(['text', 'tapback', 'richlink']),
  text: z.string().optional(),
  url: z.string().optional(),
  emoji: z.enum(CHEF_TAPBACK_KINDS).optional(),
});
type SendPayload = z.infer<typeof SendInput>;

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

// The Chef's whole prompt: reasoning conduct + HARD_RULE (from the briefing), the CHEF_VOICE persona,
// and the social-vs-work + ack-first rules. The model acts ONLY by calling tools; the objective tools
// persist what the household says and the `send` tool is the only voice. Emoji style:
// chef-tapback-emoji-style.md (tone, not decoration).
const CHEF_PROMPT = [
  'You are the Chef — a warm, brief home-cooking companion texting a household over iMessage. You both',
  'reason and speak: read the newest message against the objective, decide what must happen, persist it,',
  'and say it — all yourself, in one voice.',
  '',
  'You act ONLY by calling tools. Never write prose in your answer — everything the household sees, you',
  'send with the `send` tool. Read the newest message and do ONE of:',
  '',
  '- It is purely social — pure enthusiasm, a thanks, small talk that bears on no objective: `send` a',
  '  tapback, or one short warm line. No other tools.',
  '- It bears on the objective in ANY way — an allergy, a preference, an answer, a request, anything to',
  '  capture or to move the objective forward — or you are unsure: FIRST `send` a brief, warm, contextual',
  '  ack as your VERY FIRST action (e.g. "on it 🤔", "let me pull that together") so they know you heard',
  '  them. THEN call the persist tools (update_tasks / update_facts / create_household / …) to record',
  '  what they said and advance the objective. THEN `send` the result: confirm what landed and ask the',
  '  next question, warmly. Bias hard toward doing the work — a dropped request is far worse than one',
  '  extra ack.',
  '',
  '# How to persist',
  'Change the world only by calling tools. After the room confirms they cook together, call',
  'create_household FIRST. Fill the objective tasks with update_tasks, addressing each by its [id]:',
  'batch every task you can answer this turn into one call, except a task marked (solo), which must be',
  'sent by itself. Record a fact the household volunteers that no task is asking for with update_facts',
  'by its key. Discover a fact type\'s legal values, or ground a loose phrase to a canonical value, with',
  'fact_types before filling. Task status is set by the tools you call.',
  '',
  '# Voice',
  'A warm friend who cooks, not an assistant. Text-message cadence, contractions, no corporate or',
  'chatbot filler. Keep it to one or two short messages — never a paragraph, markdown, headers, or a',
  'wall of text. Use emoji as tone, at most one per message, usually none; never 😂, 😭, or 🙂.',
  '',
  '# HARD RULE',
  'Never write a value the tools did not return. If a value has no catalog match, acknowledge it and',
  'move on — never confirm or guess it. Preserve every fact exactly as its meaning — if an allergy is',
  "severe, say it is severe. Never add, drop, soften, or invent a fact, and never echo the user's own",
  'words back at them.',
].join('\n');

/**
 * The live chef: a Mastra `Agent` (thinking-on-LOW) that runs ONE tool-loop generation. Its tools are
 * the active objective's reasoning tools (`buildTools`) plus `send` (flushes each outbound `ChatEvent`
 * live via `turn.send`). No structured output — the `send` calls ARE the reply, so there is no
 * structured-output-vs-tool-call two-pass. Returns whether any mutating tool ran (the `worked` flag).
 */
export class MastraChefAgent implements ChefAgent {
  constructor(private readonly apiKey: string) {}

  static create(apiKey: string): MastraChefAgent {
    return new MastraChefAgent(apiKey);
  }

  async run(turn: ChefTurn, db: Database): Promise<{ worked: boolean }> {
    const def = objectiveDefinition(turn.briefing.objective.definition);
    if (!def) throw new Error(`No definition registered for objective '${turn.briefing.objective.definition}'`);
    const model: OpenAICompatibleConfig = { id: CHEF_MODEL, url: DEEPSEEK_URL, apiKey: this.apiKey };

    let worked = false;
    const objectiveTools = buildTools(turn.ctx, db, def.tools);
    const tools: Record<string, ReturnType<typeof createTool>> = {};
    for (const t of objectiveTools) {
      const mastraTool = t.asMastraTool();
      // Wrap a mutating tool so calling it flips `worked` — the consumer's confirm gate (AC-5).
      tools[t.id] = MUTATING_TOOL_IDS.has(t.id)
        ? createTool({
            id: mastraTool.id,
            description: mastraTool.description,
            inputSchema: mastraTool.inputSchema,
            outputSchema: mastraTool.outputSchema,
            execute: async (...args: Parameters<NonNullable<typeof mastraTool.execute>>) => {
              worked = true;
              return mastraTool.execute!(...args);
            },
          })
        : mastraTool;
    }

    tools.send = createTool({
      id: 'send',
      description:
        'Send something to the household. type="text" with `text` for a message; type="tapback" to ' +
        'react to their last message with a warm heart; type="richlink" with `url` to share a recipe ' +
        'link. Call once per thing you send.',
      inputSchema: SendInput,
      execute: async (payload: SendPayload) => {
        const e = sendEvent(payload, turn.triggerExternalId);
        if (e) await turn.send(e);
        return { sent: e !== null };
      },
    });

    const agent = new Agent({ id: 'chef', name: 'chef', instructions: CHEF_PROMPT, model, tools });
    await agent.generate(prepareBriefing(turn.briefing), {
      providerOptions: THINKING_LOW,
      stopWhen: ({ steps }: { steps: unknown[] }) => steps.length >= MAX_STEPS,
    });
    return { worked };
  }
}

/**
 * Test double: no network. A scripted single agent — records the tool calls it would make and drives
 * the `sink` with fixed `send` payloads. `mutate` marks the turn as work (a mutating tool ran) so the
 * `worked` gate is exercised offline; `send` is the list of bubbles to flush. Default: a working turn
 * (mutates, no explicit sends).
 */
export class ScriptedChefAgent implements ChefAgent {
  constructor(private readonly script: { mutate?: boolean; send?: SendPayload[] } = { mutate: true }) {}

  async run(turn: ChefTurn, _db: Database): Promise<{ worked: boolean }> {
    prepareBriefing(turn.briefing); // exercise the pure assembly (throws on an unregistered objective)
    for (const p of this.script.send ?? []) {
      const e = sendEvent(p, turn.triggerExternalId);
      if (e) await turn.send(e);
    }
    return { worked: this.script.mutate ?? false };
  }
}

/**
 * The chef agent for the current env: the live Mastra agent when `DEEPSEEK_API_KEY` is set, else the
 * offline scripted double. Tests pass their own `ScriptedChefAgent`; this selector is the env gate.
 */
export function selectChefAgent(): ChefAgent {
  if (process.env.DEEPSEEK_API_KEY) return MastraChefAgent.create(process.env.DEEPSEEK_API_KEY);
  return new ScriptedChefAgent();
}
