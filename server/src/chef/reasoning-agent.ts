import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import type { OpenAICompatibleConfig } from '@mastra/core/llm';
import { prepareBriefing, type BriefingInput } from './briefing.js';
import { ReasoningOutputSchema, type ReasoningOutput } from './types.js';
import { objectiveDefinition } from './objectives/index.js';
import { buildTools } from './tools/registry.js';
import type { SaveResult, TurnContext } from './tools/types.js';

// ponytail: swap the id if DeepSeek renames it. `-flash` with thinking ON (DeepSeek's default) is the
// middle ground: reasoning fixes decision quality (thinking-OFF conflated household members) while
// flash's small size keeps the reasoning trace — and so the latency — a fraction of `-pro`'s
// (~6s/call vs 30-120s). See NOTE on run().
const REASONING_MODEL = 'deepseek/deepseek-v4-flash';
const DEEPSEEK_URL = 'https://api.deepseek.com';
// An onboarding turn needs at most create_household + a couple saves + the submit call. Cap the
// tool-loop tight — with thinking ON, every extra step is another expensive reasoning call.
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
 * The live reasoning agent: a Mastra `Agent` on DeepSeek `-flash` (thinking on) with the active objective's tools
 * (self-contained classes bound to this turn), running the native tool-loop plus a `submit_reply_plan`
 * tool for `{replyPlan, slotUpdates}` in ONE call. The tools write during the loop; afterward we reconcile
 * the model's slot declarations against what actually landed. The plan returns via the registered submit
 * tool (a native tool schema) rather than a jsonPromptInjection structured output.
 *
 * NOTE (chef-reasoning, revisit): thinking is left ON (DeepSeek's default) because thinking-OFF
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
    const model: OpenAICompatibleConfig = { id: REASONING_MODEL, url: DEEPSEEK_URL, apiKey: this.apiKey };
    const briefing = prepareBriefing(input);

    const allSaved: SaveResult[] = [];
    let plan: ReasoningOutput | null = null;
    for (let attempt = 0; attempt < MAX_ATTEMPTS && !plan; attempt++) {
      // Rebuild tools each attempt so canRun re-evaluates against ctx a prior attempt may have mutated
      // (e.g. create_household set householdId → it drops out, save_* become legal).
      const tools = buildTools(ctx, def.tools);
      // Capture the plan through a registered submit tool rather than structuredOutput: the model ends
      // the tool loop with an explicit final call (more reliable than parsing a trailing structured
      // object) and it drops the jsonPromptInjection hack for a native tool schema. The holder captures
      // the model's final call; stopWhen ends the loop the moment the plan is submitted.
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
        instructions:
          'You are the reasoning half of a private chef. Call tools to persist what the household tells you, ' +
          'then call submit_reply_plan exactly once with the reply plan and slot updates to finish. Emit no prose.',
        model,
        tools: { ...Object.fromEntries(tools.map((t) => [t.id, t.asMastraTool()])), submit_reply_plan: submitTool },
      });
      try {
        await agent.generate(briefing, {
          stopWhen: ({ steps }: { steps: unknown[] }) => !!submitted.plan || steps.length >= MAX_STEPS,
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
 * The reasoner for the current env: the live Mastra agent when `DEEPSEEK_API_KEY` is set, else the
 * offline scripted stub (empty plan). Mirrors `selectExtractor`. Tests pass their own `ScriptedReasoner`.
 */
export function selectReasoningAgent(): Reasoner {
  if (process.env.DEEPSEEK_API_KEY) return MastraReasoner.create(process.env.DEEPSEEK_API_KEY);
  return new ScriptedReasoner({ replyPlan: { intents: [], must_say: [] }, slotUpdates: [] });
}
