import { Agent } from '@mastra/core/agent';
import type { OpenAICompatibleConfig } from '@mastra/core/llm';
import type { Database } from '../db.js';
import { prepareBriefing, type BriefingInput } from './briefing.js';
import { ReasoningOutputSchema, type ReasoningOutput } from './types.js';
import { objectiveDefinition } from './objectives/index.js';
import { buildTools } from './tools/registry.js';
import type { TurnContext } from './tools/types.js';

// ponytail: swap the id if DeepSeek renames it. `-flash` with thinking ON (DeepSeek's default) is the
// middle ground: reasoning fixes decision quality (thinking-OFF conflated household members) while
// flash's small size keeps the reasoning trace — and so the latency — a fraction of `-pro`'s
// (~6s/call vs 30-120s). See NOTE on run().
const REASONING_MODEL = 'deepseek/deepseek-v4-flash';
const DEEPSEEK_URL = 'https://api.deepseek.com';
// An onboarding turn batches typed task fills through update_tasks, plus a few fact_types grounding
// lookups and the final answer. ~10 steps fits the batched fills; with thinking ON each step is an
// expensive reasoning call, so keep it capped.
const MAX_STEPS = 10;
// The tool-loop intermittently ends on a tool call with no final structured object (res.object
// undefined); we retry the whole call rather than a second tool-free phase.
const MAX_ATTEMPTS = 3;

/**
 * The reasoning half of the Chef. `run` drives the tool loop and returns a validated
 * `DeliberationResult`; the real path is a Mastra agent, the test path a scripted reasoner (no
 * network). Task/fact writes happen inside the `update_tasks`/`update_facts` tools during the loop —
 * the result carries only what to voice.
 */
export interface Reasoner {
  run(input: BriefingInput, ctx: TurnContext, db: Database): Promise<ReasoningOutput>;
}

/**
 * Test double: returns a fixed result with no network. Tool writes are exercised directly against
 * the tool classes in their own unit tests, so the scripted path stays a pure result replay.
 */
export class ScriptedReasoner implements Reasoner {
  constructor(private readonly result: ReasoningOutput) {}

  async run(input: BriefingInput, _ctx?: TurnContext, _db?: Database): Promise<ReasoningOutput> {
    prepareBriefing(input); // exercise the pure assembly (throws on an unregistered objective)
    return ReasoningOutputSchema.parse(this.result);
  }
}

/**
 * The live reasoning agent: a Mastra `Agent` on DeepSeek `-flash` (thinking on) with the active
 * objective's tools (self-contained classes bound to this turn), running the native tool-loop plus
 * `structuredOutput` for `{result}` in ONE call. The tools set task/fact state during the loop;
 * the result carries only what to voice. jsonPromptInjection because DeepSeek rejects the json_schema
 * response_format.
 *
 * NOTE (chef-reasoning, revisit): thinking is left ON (DeepSeek's default) because thinking-OFF
 * degraded decision quality (it conflated household members). The cost is (a) latency — reasoning
 * adds ~hundreds of tokens/call — and (b) the tool-loop sometimes ends on a tool call with no final
 * structured object, so we RETRY up to MAX_ATTEMPTS. Cleaner long-term options we deferred:
 *   - a native reasoning tool-loop over /v1/responses (carries the reasoning trace across tool calls);
 *   - a decide(thinking, no tools → plan/commands) → execute(code) split;
 *   - or confirm reasoning is only needed for orchestration, not the (shallow) tool decision, and
 *     move the tool calls to a cheap thinking-off pass.
 * Tool writes are idempotent, so retrying a call that already persisted is safe.
 */
export class MastraReasoner implements Reasoner {
  constructor(private readonly apiKey: string) {}

  static create(apiKey: string): MastraReasoner {
    return new MastraReasoner(apiKey);
  }

  async run(input: BriefingInput, ctx: TurnContext, db: Database): Promise<ReasoningOutput> {
    const def = objectiveDefinition(input.objective.definition);
    if (!def) throw new Error(`No definition registered for objective '${input.objective.definition}'`);
    const model: OpenAICompatibleConfig = { id: REASONING_MODEL, url: DEEPSEEK_URL, apiKey: this.apiKey };
    const briefing = prepareBriefing(input);

    let out: ReasoningOutput | null = null;
    for (let attempt = 0; attempt < MAX_ATTEMPTS && !out; attempt++) {
      // Rebuild tools each attempt so canRun re-evaluates against ctx a prior attempt may have mutated
      // (e.g. create_household set householdId → it drops out, save_* become legal).
      const tools = buildTools(ctx, db, def.tools);
      const agent = new Agent({
        id: 'chef-reasoning',
        name: 'chef-reasoning',
        instructions: 'You are the reasoning half of a private chef. Call update_tasks/update_facts to persist what the household tells you, then return the deliberation result. Emit no prose.',
        model,
        tools: Object.fromEntries(tools.map((t) => [t.id, t.asMastraTool()])),
      });
      let object: unknown;
      try {
        const res = await agent.generate(briefing, {
          structuredOutput: { schema: ReasoningOutputSchema, jsonPromptInjection: true },
          stopWhen: ({ steps }: { steps: unknown[] }) => steps.length >= MAX_STEPS,
        });
        object = (res as { object: unknown }).object;
      } catch (err) {
        console.warn(`[chef] reasoning attempt ${attempt + 1}/${MAX_ATTEMPTS} threw:`, (err as Error)?.message);
      }
      const parsed = ReasoningOutputSchema.safeParse(object);
      if (parsed.success) out = parsed.data;
      else console.warn(`[chef] reasoning attempt ${attempt + 1}/${MAX_ATTEMPTS}: object ${object ? 'malformed' : 'undefined'}${attempt + 1 < MAX_ATTEMPTS ? ', retrying' : ''}`);
    }
    if (!out) {
      console.warn('[chef] reasoning: all attempts failed; returning an empty result.');
      out = { result: { communicate: [], ask: [] } };
    }
    return { result: out.result };
  }
}

/**
 * The reasoner for the current env: the live Mastra agent when `DEEPSEEK_API_KEY` is set, else the
 * offline scripted stub (empty plan). Mirrors `selectExtractor`. Tests pass their own `ScriptedReasoner`.
 */
export function selectReasoningAgent(): Reasoner {
  if (process.env.DEEPSEEK_API_KEY) return MastraReasoner.create(process.env.DEEPSEEK_API_KEY);
  return new ScriptedReasoner({ result: { communicate: [], ask: [] } });
}
