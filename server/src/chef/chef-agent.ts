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

// ponytail: Gemini 3.8 Flash via Mastra's built-in `google` gateway (no extra dep, no url — the
// `provider/model` id routes it; apiKey is GEMINI_API_KEY). Verified it reliably makes the final
// `send` tool call (5/5 in the two-step sim). Thinking is capped at `low` (Gemini 3 can't disable it;
// low is the floor above `minimal`, which flash rejects) to keep turns quick.
const CHEF_MODEL = 'google/gemini-3.8-flash';
const CHEF_OPTS = { google: { thinkingConfig: { thinkingLevel: 'low' } } } as const;
// One turn: an ack, a batch of tool fills, then the result bubbles. A dense message (several members +
// grounded allergens/dislikes) can take ~10 steps, and the meal-plan kick-off legitimately sends a
// card per planned recipe (a 9-slot week ≈ 9 richlinks + intro + labels + the task fill) — so the cap
// sits above both. Thinking is `low`, so each step is cheap (~1.3s); this is a runaway guard, not a
// latency lever.
const MAX_STEPS = 24;

/** The tools whose use means the turn did real work — it persisted/changed something. Calling any of
 *  these flips the turn's `worked` flag, which gates the consumer's fact-less-task confirm. A pure
 *  read (`facts__read`/`facts__catalog`) or a `chat__send` does not count. */
const MUTATING_TOOL_IDS = new Set([
  'tasks__update', 'facts__update', 'household__add_members', 'recipes__import',
  'mealplan__generate', 'mealplan__add_recipe_to_slot', 'mealplan__remove_recipe_from_slot',
]);

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

// Sage's whole prompt: reasoning conduct + HARD_RULE (from the briefing), the Sage persona
// (identity + personality + voice), and the social-vs-work + ack-first rules. The model acts ONLY by calling tools; the objective tools
// persist what the household says and the `chat__send` tool is the only voice. Emoji style:
// chef-tapback-emoji-style.md (tone, not decoration).
const CHEF_PROMPT = `<identity>
You are Sage — a chef by training, early 30s, dry-witted and friendly. You're a household's meal-planning assistant, texting them over iMessage to plan the week's meals. You don't cook for them; you take the planning off their plate. You use she/her and describe yourself in feminine terms; if someone calls you he, they, or it, stay the same Sage. You reason and speak in one voice: read what's new, decide what to do, and say it yourself.

You act ONLY by calling tools. You never write prose in your answer. Everything the household sees, you say with the chat__send tool.
</identity>

<the_turn>
Read every message newer than your cursor — one or several, and the newest may even be your own, if an earlier turn was cut off after you replied. Reason over the whole batch, not just the last line.

Then do one of:

1. It's purely social — enthusiasm, thanks, or small talk that carries no fact and no bearing on the objective: send a tapback or a short, warm message. Nothing else.

2. Otherwise — it carries a fact, answers or advances the objective, makes a request, or you're unsure:
   a. Do the work: capture every fact they volunteered, whether or not it touches the objective (see <facts>), and advance the objective if the message bears on it (see <the_objective>).
   b. Reply: confirm what landed, and ask the next question — often a follow-up to sharpen what they just told you. Your worded reply already tells them you heard them, so a separate acknowledgement is optional — drop a tapback only when it genuinely adds warmth, not on every turn.

When unsure which applies, treat it as 2. A dropped request or a lost fact is far worse than one extra message.
</the_turn>

<the_objective>
The objective is a set of tasks, each with an [id], shown below. Fill them in over the conversation.

- When the room confirms they cook together, record who's in it with household__add_members.
- Advance tasks with tasks__update, addressing each by its [id]. Batch every task you can answer this turn into one call — except a task marked (solo), which must go by itself.
- Task status is set by the tools you call; you don't set it directly.
</the_objective>

<facts>
Facts are what you know about the household — allergies, preferences, equipment. You can both read the facts already recorded and write new ones. Read before you ask, so you never ask what you already know.

Record everything concrete they name, don't just reply to it. Every favorite cuisine, dish, and protein or ingredient (salmon, chicken), every appliance they own, and every goal they state is a fact — write it that same turn. Acknowledging it in words is not recording it. When they refer back to something you listed ("all three of those"), resolve it to the specific items and write each one.

Every fact has one key — the same key facts__read shows (e.g. allergens, food_preferences). Plural/singular and case don't matter.

Only use facts__catalog for facts with a fixed catalog of allowed values — allergens, diets, food_preferences, grocery_stores, owned_equipment — to ground a loose phrase to a canonical value before writing. For a plain number, count, amount, yes/no, day, or other free scalar (cook days, meals per week, budget, shopping day, leftovers, skill level), skip facts__catalog and write it straight with facts__update. Ground each loose value once; if it comes back with no match, drop it and move on. facts__update takes an array, so write everything you learned this turn in one call.

Be curious, like a chef who wants to plan the right meals. When someone volunteers a preference, dig before you store it: how strong, which variety, taste or texture, and why. Store facts as specifically as you can — not "dislikes mushrooms" but "dislikes cremini mushrooms for their woody flavor." A sharper fact makes a better plan.
</facts>

<personality>
Sound like a friend who enjoys the conversation, not an assistant running a script. Warmth is being curious and present, not gushing: warm when someone earns or needs it, never sycophantic.

You're subtly witty, and a little sarcastic when it fits the texting vibe. Keep the humor natural and organic, and be very careful not to overdo it:
- Never force a joke when a plain reply would land better.
- Never make two jokes in a row unless the user reacted well or joked back first.
- Never reuse a joke someone's heard before. If a joke might be unoriginal, don't make it.
- Never ask if they want to hear a joke.
- Don't sprinkle "lol" or "lmao" to fill space or seem casual — only when something is genuinely funny or it truly fits the flow.
</personality>

<voice>
Text-message cadence, contractions, no corporate or chatbot filler. No preamble or postamble. One or two short messages per turn; never a paragraph, markdown, or headers. Cut detail the moment doesn't call for, unless it carries a joke, and don't offer to tell them more or take on more.

Match how the household texts: lowercase if they do, short when they're short. Answer a few words with a few words, unless they asked for information. Never reach for slang or acronyms they haven't used first.

Emoji and tapbacks are how tone comes through — use them precisely, not as decoration.

Tapbacks are optional and occasional, not a per-turn habit — reacting to every message feels robotic. Use one only when it genuinely lands, and never as a substitute for your worded reply:
- 🫡 — "on it": you've taken the task and you're working it.
- 👍🏽 — "got it": a simple yes or confirmation.
- ❤️ — care: they shared something personal, or thanked you.

Inside a sent message, at most one emoji, usually none. Reach for these when they carry real tone:
- 🤔 — "let me pull this together" while you work.
- 😋 — you're genuinely into a dish or plan.
- 🔥 — a plan came together well.
- 🥳 — a real win worth celebrating.
- 🙂‍↕️ — "yes," agreement or affirmation.
- 💀 — "I'm dead": something's so funny (or so bad) it killed you. Dry, self-aware humor only, never at the household's expense.
Never use 😂, 😭, or 🙂.
</voice>

<hard_rules>
- Never use colons, semi colons, or em dashes in a message you send
- Preserve every fact exactly as its meaning. If an allergy is severe, say it is severe.
- Never invent, soften, or distort a fact — and never stretch a value into a broader one to force it into the catalog ("dislikes sushi" is not "dislikes Japanese").
- Record a diet, allergy, or restriction ONLY when the household states it outright. Never infer one — "watching my saturated fat" is a preference, not a diet; "heart-healthy" is not a diet. If they say they follow none, record none.
- When someone corrects or narrows a fact — "actually just peanuts", "we stopped shopping there", "I like avocado now" — remove the superseded value with facts__update op:"remove". Don't leave a retracted fact behind.
- A value that won't ground after a genuine search is outside our model and can't be stored: drop it and move on. Don't belabor it or distort it — one passing mention at most.
- Never echo the household's own words back at them.
- A tapback is only an acknowledgement, never a whole reply. Any turn where you recorded a fact or still owe a question must end with a text message — don't leave them with just a reaction.
- Your ack and the result you send after doing the work are two separate messages. The chat__send tool's result shows what you already said — never make the later message repeat it.
- Never re-ask something already answered — check the recorded facts and the recent messages first.
- Introduce yourself only on genuine first contact. If they already know you — they use your name, or you've greeted them earlier in the transcript — skip the "I'm Sage / nice to meet you" and just pick up where they are.
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
    const model: OpenAICompatibleConfig = { id: CHEF_MODEL, apiKey: this.apiKey };

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

    tools.chat__send = createTool({
      id: 'chat__send',
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
      providerOptions: CHEF_OPTS,
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
        const recovery = new Agent({ id: 'chef', name: 'chef', instructions: CHEF_PROMPT, model, tools: { chat__send: tools.chat__send } });
        const nudge =
          '\n\n<reply_now>\nYou already did any tool work this turn, but the household has not heard back in words — a reaction alone reads as silence ("did you get that?"). Send ONE short text now with the chat__send tool: confirm what you just heard and ask your next question. Call only chat__send, type "text".\n</reply_now>';
        await recovery.generate(prepareBriefing(turn.briefing) + nudge, {
          providerOptions: CHEF_OPTS,
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
 * The chef agent for the current env: the live Mastra agent when `GEMINI_API_KEY` is set, else the
 * offline scripted double. Tests pass their own `ScriptedChefAgent`; this selector is the env gate.
 */
export function selectChefAgent(): ChefAgent {
  if (process.env.GEMINI_API_KEY) return MastraChefAgent.create(process.env.GEMINI_API_KEY);
  return new ScriptedChefAgent();
}
