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
const MUTATING_TOOL_IDS = new Set(['update_tasks', 'update_facts', 'add_members', 'import_recipe']);

/**
 * One turn's inputs to the single chef agent. `briefing`/`ctx` build the objective tools and the
 * prompt body; `send` flushes each outbound `ChatEvent` live through the Consumer's sink (journal +
 * send, idempotent). `triggerExternalId` is the only id a tapback can ground on.
 */
export interface ChefTurn {
  briefing: BriefingInput;
  ctx: TurnContext;
  /** The platform id of the message this turn answers — the default target a tapback grounds on.
   *  Null ⇒ an untargeted tapback can't be sent; the agent sends text instead. */
  triggerExternalId: string | null;
  /** `[m#]` handle → platform id for every message shown this turn, so a tapback can target any of
   *  them by handle. The model never sees a raw id; the resolver looks it up here. */
  messageTargets: Record<string, string>;
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
  /** For a tapback: the `[m#]` handle of the message to react to; omit to react to the trigger. */
  target: z.string().optional(),
});
type SendPayload = z.infer<typeof SendInput>;

/** Chef's default tapback — a warm heart. Structurally confined to CHEF_TAPBACK_KINDS
 *  (love/laugh/emphasize), so like/dislike can never be sent (compile-bounded, not just a prompt rule). */
function defaultTapback(): TapbackKind {
  return CHEF_TAPBACK_KINDS[0]; // 'love' — the safe cross-generational affirmation
}

/**
 * One `send` payload → its `ChatEvent`, resolving a tapback's target from a `[m#]` handle against the
 * turn's REAL platform ids (never a model-supplied raw id) — an unknown handle, or none plus no
 * trigger, grounds nowhere. Returns null when the payload can't ground: a `tapback` with no resolvable
 * target, or a `text`/`richlink` missing its content — the caller drops it rather than send bogus.
 */
export function sendEvent(
  p: SendPayload,
  triggerExternalId: string | null,
  messageTargets: Record<string, string> = {},
): ChatEvent | null {
  switch (p.type) {
    case 'text':
      return p.text ? { kind: 'text', text: p.text } : null;
    case 'richlink':
      return p.url ? { kind: 'richlink', url: p.url } : null;
    case 'tapback': {
      const target = p.target ? messageTargets[p.target] : triggerExternalId;
      return target ? { kind: 'tapback', target, emoji: p.emoji ?? defaultTapback() } : null;
    }
  }
}

// The Chef's whole prompt: reasoning conduct + HARD_RULE (from the briefing), the CHEF_VOICE persona,
// and the social-vs-work + ack-first rules. The model acts ONLY by calling tools; the objective tools
// persist what the household says and the `send` tool is the only voice. Emoji style:
// chef-tapback-emoji-style.md (tone, not decoration).
const CHEF_PROMPT = `<identity>
You are the Chef — a warm, brief home-cooking companion texting a household over iMessage. You are one voice that both reasons and speaks: you read what's new, decide what must happen, and say it — all yourself.

You act ONLY by calling tools. You never write prose in your answer. Everything the household sees, you say with the send tool.
</identity>

<the_turn>
Read every message newer than your last cursor. That may be one message or several — and the most recent one may even be your own, if an earlier turn was interrupted after you replied. Reason over the whole batch, not just the last line.

Then do one of:

1. It's purely social — enthusiasm, thanks, small talk carrying no fact and no bearing on the objective: send a tapback or a short, warm message. Nothing else.

2. Otherwise — it carries a fact, answers or advances the objective, makes a request, or you're unsure:
   a. First, acknowledge, so they know you heard them — a tapback or a brief line (see <voice>).
   b. Then do the work: capture every fact they volunteered, whether or not it touches the objective (see <facts>), and advance the objective if the message bears on it (see <the_objective>).
   c. Then send the result: confirm what landed, and ask the next question — often a follow-up to sharpen what they just told you.

When unsure which applies, treat it as 2. A dropped request or a lost fact is far worse than one extra message.
</the_turn>

<the_objective>
The objective is a set of tasks, each with an [id], shown below. Your job across the conversation is to fill them in.

- When the room confirms they cook together, record who's in it with add_members.
- Advance tasks with update_tasks, addressing each by its [id]. Batch every task you can answer this turn into one call — except a task marked (solo), which must go by itself.
- Task status is set by the tools you call; you don't set it directly.
</the_objective>

<facts>
Facts are what you know about the household — allergies, preferences, equipment. You can both read the facts already recorded and write new ones. Read before you ask, so you never ask what you already know.

Every fact has one key — the same key read_facts shows (e.g. allergens, food_preferences). Use that one key everywhere: fact_types to see its legal values or ground a loose phrase, then update_facts to write it. Plural/singular and case don't matter.

Be curious, like a chef who wants to cook you the right thing. When someone volunteers a preference, dig before you store it — how strong is it, which variety, taste or texture, and why. Store facts at the lowest level of granularity you can: not "dislikes mushrooms" but "dislikes cremini mushrooms for their woody flavor." A sharper fact is a better recommendation later.
</facts>

<voice>
You are a warm friend who cooks, not an assistant. Warmth here is being genuinely curious and present — not gushing. Text-message cadence, contractions, no corporate or chatbot filler. One or two short messages per turn; never a paragraph, markdown, headers, or a wall of text.

Emoji and tapbacks are how tone comes through — use them precisely, not as decoration.

Tapbacks (react to their message, to acknowledge without interrupting):
- 🫡 — "on it": you've taken the task and you're working it.
- 👍🏽 — "got it": a simple yes or confirmation.
- ❤️ — care: they shared something personal, or thanked you.

Inside a sent message, at most one emoji, usually none:
- 🤔 — "let me pull this together" while you work.
Never use 😂, 😭, or 🙂.
</voice>

<hard_rules>
- Preserve every fact exactly as its meaning. If an allergy is severe, say it is severe.
- Never invent, soften, or distort a fact — and never stretch a value into a broader one to force it into the catalog ("dislikes sushi" is not "dislikes Japanese").
- A value that won't ground after a genuine search is outside our model and can't be stored: drop it and move on. Don't belabor it or distort it — one passing mention at most.
- Never echo the household's own words back at them.
- A tapback is only an acknowledgement, never a whole reply. Any turn where you recorded a fact or still owe a question must end with a text message — don't leave them with just a reaction.
- Your ack and the result you send after doing the work are two separate messages. The send tool's result shows what you already said — never make the later message repeat it.
- Never re-ask something already answered — check the recorded facts and the recent messages first.
</hard_rules>`;

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
    let spoke = false; // any bubble (incl. a tapback) shipped this turn
    let spokeText = false; // a TEXT bubble shipped — a tapback alone doesn't count as a worded reply
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
        'The household\'s only channel — everything they see, you say here. type="text" sends a message ' +
        '(`text`); type="tapback" reacts to a message (`target` its [m#] handle from the transcript, ' +
        'default the one that triggered this turn; optional `emoji`, default a warm heart); ' +
        'type="richlink" shares a recipe (`url`). One call per bubble.',
      inputSchema: SendInput,
      execute: async (payload: SendPayload) => {
        const e = sendEvent(payload, turn.triggerExternalId, turn.messageTargets);
        if (e) {
          await turn.send(e);
          spoke = true;
          if (e.kind === 'text') spokeText = true;
        }
        // Echo the sent text back so a later step plainly sees what already went to the household —
        // the ack rides only in this call's args otherwise, and the bare {sent} let the final bubble
        // restate it. Surfacing it as a result the model reads stops the ack↔final repetition.
        return { sent: e !== null, said: e?.kind === 'text' ? e.text : undefined };
      },
    });

    const agent = new Agent({ id: 'chef', name: 'chef', instructions: CHEF_PROMPT, model, tools });
    const result = await agent.generate(prepareBriefing(turn.briefing), {
      providerOptions: THINKING_LOW,
      stopWhen: ({ steps }: { steps: unknown[] }) => steps.length >= MAX_STEPS,
    });

    // Recovery: the model sometimes ends a turn with no WORDS — only a tapback (which reads as
    // "Did you get that?"), or a bailed-to-prose step that never called send. Re-run once with a
    // send-only agent (no fact tools, so it can't thrash) to deliver the reply as text. Fires when a
    // turn did real work but sent no text, or shipped nothing at all — never on a purely social tapback.
    if (!spokeText && (worked || !spoke)) {
      // Best-effort: a failed re-gen must NEVER break the turn. The work is already committed and any
      // bubble already sent; a throw here would abort the consumer's commit and trigger a redelivery
      // re-run. So swallow — a missing recovery reply is recoverable next turn; a crash-loop is not.
      try {
        const recovery = new Agent({ id: 'chef', name: 'chef', instructions: CHEF_PROMPT, model, tools: { send: tools.send } });
        const nudge =
          '\n\n<reply_now>\nYou already did any tool work this turn, but the household has not heard back in words — a reaction alone reads as silence ("did you get that?"). Send ONE short text now with the send tool: confirm what you just heard and ask your next question. Call only send, type "text".\n</reply_now>';
        await recovery.generate(prepareBriefing(turn.briefing) + nudge, {
          providerOptions: THINKING_LOW,
          stopWhen: ({ steps }: { steps: unknown[] }) => steps.length >= 3,
        });
      } catch (err) {
        if (process.env.CHEF_DEBUG) console.error('[chef-debug] recovery failed (non-fatal):', err);
      }
    }
    if (process.env.CHEF_DEBUG) {
      const r = result as {
        finishReason?: string;
        text?: string;
        reasoningText?: string;
        steps?: { finishReason?: string; text?: string; reasoningText?: string; toolCalls?: unknown[]; toolResults?: unknown[] }[];
      };
      const callSummary = (c: unknown): string => {
        const o = (c ?? {}) as { toolName?: string; payload?: unknown; args?: unknown; input?: unknown };
        return `${o.toolName ?? '?'}(${JSON.stringify(o.args ?? o.input ?? o.payload ?? {})})`;
      };
      console.error(`\n========== CHEF DEBUG (spoke=${spoke}, spokeText=${spokeText}, worked=${worked}, steps=${r.steps?.length}, top.finish=${r.finishReason}) ==========`);
      (r.steps ?? []).forEach((s, i) => {
        console.error(`\n──── step ${i} — finish=${s.finishReason} ────`);
        if (s.reasoningText) console.error(`  reasoning: ${s.reasoningText}`);
        (s.toolCalls ?? []).forEach((c) => console.error(`  → call: ${callSummary(c)}`));
        (s.toolResults ?? []).forEach((res) => console.error(`  ← result: ${JSON.stringify((res as { result?: unknown; output?: unknown }).result ?? (res as { output?: unknown }).output ?? res)}`));
        if (s.text) console.error(`  text: ${JSON.stringify(s.text)}`);
      });
      console.error(`\n========== top.text: ${JSON.stringify(r.text ?? '')} ==========\n`);
    }
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
      const e = sendEvent(p, turn.triggerExternalId, turn.messageTargets);
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
