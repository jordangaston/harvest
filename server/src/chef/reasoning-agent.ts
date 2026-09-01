import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import type { OpenAICompatibleConfig } from '@mastra/core/llm';
import { prepareBriefing, type BriefingInput } from './briefing.js';
import { ReasoningOutputSchema, type ReasoningOutput } from './types.js';
import { objectiveDefinition } from './objectives/index.js';
import { buildTools } from './tools/registry.js';
import type { SaveResult, TurnContext } from './tools/types.js';

// Groq-hosted gpt-oss-120b (LPU): a real reasoning tier at several times DeepSeek's throughput, so the
// reasoning trace stays cheap in wall-clock. `reasoning_effort: 'low'` is the light-but-on tier —
// enough decision quality (fully-off once conflated household members) without a long trace.
const REASONING_MODEL = 'openai/gpt-oss-120b';
const REASONING_PROVIDER_OPTS = { openai: { reasoningEffort: 'low' } } as const;

// The reasoner's system prompt — the DECIDER half's counterpart to the responder's CHEF_VOICE. The
// per-turn briefing (briefing.ts) carries the objective, open slots, and safety mechanics; this sets
// the pace: it is texting a real person, so it learns ONE thing at a time and never floods them. (The
// acknowledge-then-ask-one structure below measurably beats a terse version on warmth and pacing;
// tool-turn latency is driven by the tool-loop step count, not this prompt's length.)
const REASONING_DIRECTIVE = [
  'You are the reasoning half of the Chef — the planner behind a warm private chef helping a household',
  'over iMessage. You never speak to the user: a separate voice half phrases what you decide. Your job',
  'is to decide what is true, persist it with tools, and hand over a SMALL plan of what to say.',
  '',
  'You are texting a real person on their phone, not filling out a form. People take in a little at a',
  'time. Move at a human pace — learn ONE thing per turn, react to what they just said, and ask for the',
  'next single thing, the way a friend who cooks would, never an intake survey.',
  '',
  'How to plan a turn:',
  '1. Read what just arrived. Persist anything it tells you by calling the right tool THIS turn — save',
  '   generously: if they volunteer three things, record all three.',
  '2. Acknowledge what they just shared, briefly, so they feel heard.',
  '3. Ask for AT MOST ONE new thing. Pick the single most natural next slot given what they just said —',
  '   not the longest list of what is still empty. Two tiny facts may share a turn only when they are',
  '   truly one question ("just you two, or kids as well?"); never stack unrelated asks.',
  '4. Keep the plan small: one acknowledgment, at most one confirm, at most one question. Reserve',
  '   must_say for the rare line that must survive word-for-word (a safety fact like a severe allergy).',
  '5. Call submit_reply_plan exactly once with that plan and the slot updates. Emit no prose.',
  '',
  'Always:',
  '- Persist generously, ask minimally: record everything they give, but ask for only ONE thing back.',
  '- When many slots are open, choose the one that follows most naturally from their last message and',
  '  leave the rest for later turns — the conversation has many turns to fill them.',
  '- Confirm sparingly: echo back only a fact that genuinely needs it (an allergy), not every detail.',
  '- Let it breathe — a turn that just acknowledges and asks one easy question is exactly right.',
  '',
  'Never:',
  '- Never ask for two or more unrelated things at once, and never present a checklist of what you',
  '  still need — that floods a person texting and it is the single thing to avoid most.',
  '- Never pile up facts, numbers, or confirmations in one turn.',
  "- Never re-ask something already answered, and never echo the user's own words back at them.",
  '- Never write a value a tool did not return, and never emit prose — you produce only the plan',
  '  (intents + must_say) and the slot updates.',
  '',
  'Example — they just said "it\'s me and my partner, no kids":',
  'Create the household, then plan ONE gentle next step — acknowledge "just the two of you", and ask a',
  'single question like "what are you hoping to get out of cooking — eating healthier, saving money,',
  'something else?" Do NOT also ask about budget, stores, and schedule in the same turn.',
].join('\n');
// An onboarding turn needs at most create_household + a couple saves + the submit call. Cap the
// tool-loop tight — with reasoning on, every extra step is another reasoning call.
const MAX_STEPS = 5;
// The model occasionally finishes without calling submit_reply_plan (no plan captured); we retry
// the whole call rather than a second tool-free phase.
const MAX_ATTEMPTS = 3;

/**
 * The reasoning half of the Chef. `run` drives the tool loop and returns a validated plan; the real
 * path is a Mastra agent, the test path a scripted reasoner (no network). Writes happen inside the
 * tools during the loop; `run` reconciles the model's slot declarations against what actually landed.
 */
export interface Reasoner {
  run(input: BriefingInput, ctx: TurnContext): Promise<ReasoningOutput>;
}

/**
 * Test double: returns a fixed plan with no network. Tool writes are exercised directly against the
 * tool classes in their own unit tests, so the scripted path stays a pure plan replay.
 */
export class ScriptedReasoner implements Reasoner {
  constructor(private readonly plan: ReasoningOutput) {}

  async run(input: BriefingInput, _ctx?: TurnContext): Promise<ReasoningOutput> {
    prepareBriefing(input); // exercise the pure assembly (throws on an unregistered objective)
    return ReasoningOutputSchema.parse(this.plan);
  }
}

/**
 * The live reasoning agent: a Mastra `Agent` on Groq gpt-oss-120b (reasoning_effort low) with the active objective's tools
 * (self-contained classes bound to this turn), running the native tool-loop plus `structuredOutput`
 * for `{replyPlan, slotUpdates}` in ONE call. The tools write during the loop; afterward we reconcile
 * the model's slot declarations against what actually landed. The plan returns via a registered
 * `submit_reply_plan` tool because gpt-oss delivers structured data as a tool call, not as content.
 *
 * NOTE (chef-reasoning, revisit): reasoning is left ON at `low` effort because fully-off
 * degraded decision quality (it conflated household members). The cost is (a) latency — reasoning
 * adds ~hundreds of tokens/call — and (b) the tool-loop sometimes ends on a tool call with no final
 * structured object, so we RETRY up to MAX_ATTEMPTS. Cleaner long-term options we deferred:
 *   - a native reasoning tool-loop over /v1/responses (carries the reasoning trace across tool calls);
 *   - a decide(thinking, no tools → plan/commands) → execute(code) split;
 *   - or confirm reasoning is only needed for orchestration, not the (shallow) tool decision, and
 *     move the tool calls to a cheap thinking-off pass.
 * Writes are idempotent, so retrying a call that already persisted is safe (reconcile dedupes).
 */
export class MastraReasoner implements Reasoner {
  constructor(private readonly apiKey: string) {}

  static create(apiKey: string): MastraReasoner {
    return new MastraReasoner(apiKey);
  }

  async run(input: BriefingInput, ctx: TurnContext): Promise<ReasoningOutput> {
    const def = objectiveDefinition(input.objective.definition);
    if (!def) throw new Error(`No definition registered for objective '${input.objective.definition}'`);
    const model: OpenAICompatibleConfig = { providerId: 'groq', modelId: REASONING_MODEL, apiKey: this.apiKey };
    const briefing = prepareBriefing(input);

    const allSaved: SaveResult[] = [];
    let plan: ReasoningOutput | null = null;
    for (let attempt = 0; attempt < MAX_ATTEMPTS && !plan; attempt++) {
      // Rebuild tools each attempt so canRun re-evaluates against ctx a prior attempt may have mutated
      // (e.g. create_household set householdId → it drops out, save_* become legal).
      const tools = buildTools(ctx, def.tools);
      // gpt-oss delivers structured data as a tool call (harmony 'commentary' channel), which Groq
      // rejects unless the tool is registered — so the plan comes back through a real submit tool, not
      // `structuredOutput`. The holder captures the model's final call; stopWhen ends the loop then.
      const submitted: { plan: ReasoningOutput | null } = { plan: null };
      const submitTool = createTool({
        id: 'submit_reply_plan',
        description: 'Finish the turn: submit the reply plan (what to say, in order) and the slot updates. Call this exactly once, last.',
        inputSchema: ReasoningOutputSchema,
        execute: async (input) => {
          submitted.plan = input as ReasoningOutput;
          return { submitted: true };
        },
      });
      const agent = new Agent({
        id: 'chef-reasoning',
        name: 'chef-reasoning',
        instructions: REASONING_DIRECTIVE,
        model,
        tools: { ...Object.fromEntries(tools.map((t) => [t.id, t.asMastraTool()])), submit_reply_plan: submitTool },
      });
      try {
        await agent.generate(briefing, {
          stopWhen: ({ steps }: { steps: unknown[] }) => !!submitted.plan || steps.length >= MAX_STEPS,
          providerOptions: REASONING_PROVIDER_OPTS,
        });
      } catch (err) {
        console.warn(`[chef] reasoning attempt ${attempt + 1}/${MAX_ATTEMPTS} threw:`, (err as Error)?.message);
      }
      allSaved.push(...tools.flatMap((t) => t.saved));
      const parsed = ReasoningOutputSchema.safeParse(submitted.plan);
      if (parsed.success) plan = parsed.data;
      else console.warn(`[chef] reasoning attempt ${attempt + 1}/${MAX_ATTEMPTS}: plan ${submitted.plan ? 'malformed' : 'not submitted'}${attempt + 1 < MAX_ATTEMPTS ? ', retrying' : ''}`);
    }
    if (!plan) {
      console.warn('[chef] reasoning: all attempts failed; returning an empty plan.');
      plan = { replyPlan: { intents: [], must_say: [] }, slotUpdates: [] };
    }
    const keyById = new Map(input.slots.map((s) => [s.id, s.key]));
    return { replyPlan: plan.replyPlan, slotUpdates: reconcileSlotUpdates(plan.slotUpdates, allSaved, keyById) };
  }
}

/**
 * Enforces write-first on the model's slot declarations. A slot may only stay `filled` with a value:
 * for a catalog-backed slot we take the value a tool actually persisted this turn (matched by the
 * slot's bare key, e.g. `household.grocery_stores` → `grocery_stores`); otherwise the model's own
 * value. A `filled` claim with no value from either source is downgraded to `asked` — the model can't
 * claim progress the database doesn't hold. Slots are addressed by row id; `keyById` resolves the key.
 */
function reconcileSlotUpdates(updates: ReasoningOutput['slotUpdates'], saved: SaveResult[], keyById: Map<string, string>): ReasoningOutput['slotUpdates'] {
  const savedBySuffix = new Map<string, unknown>();
  for (const r of saved) for (const [k, v] of Object.entries(r.saved)) savedBySuffix.set(k, v);
  return updates.map((u) => {
    if (u.status !== 'filled') return { id: u.id, status: u.status };
    const bareKey = (keyById.get(u.id) ?? '').split('.').pop()!;
    const value = savedBySuffix.get(bareKey) ?? u.value;
    return value == null ? { id: u.id, status: 'asked' as const } : { id: u.id, status: 'filled' as const, value };
  });
}

/**
 * The reasoner for the current env: the live Mastra agent when `GROQ_API_KEY` is set, else the
 * offline scripted stub (empty plan). Mirrors `selectExtractor`. Tests pass their own `ScriptedReasoner`.
 */
export function selectReasoningAgent(): Reasoner {
  if (process.env.GROQ_API_KEY) return MastraReasoner.create(process.env.GROQ_API_KEY);
  return new ScriptedReasoner({ replyPlan: { intents: [], must_say: [] }, slotUpdates: [] });
}
