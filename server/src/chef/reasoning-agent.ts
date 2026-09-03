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
 * objective's tools. Two phases per turn: (1) the tool loop persists task/fact state, (2) a separate
 * TOOL-FREE `structuredOutput` pass emits the `DeliberationResult`. Splitting them removed the old
 * failure mode where a saturated tool loop ended on a tool call with no final text → `object`
 * undefined → a 3× whole-loop retry (measured 95-210s); the tool-free structured pass is ~2.5s and
 * 0-undefined. jsonPromptInjection stays because DeepSeek rejects the json_schema response_format
 * Mastra sends natively for this model (probed: native → HTTP 400).
 *
 * NOTE (chef-reasoning, revisit): thinking is left ON (DeepSeek's default) because thinking-OFF
 * degraded decision quality (it conflated household members). Phase 2 no longer rebuilds tools after a
 * mid-turn create_household, but it's tool-free so that's irrelevant. Revisit if Mastra ships a
 * `supportsStructuredOutputs: false` override for OpenAICompatible DeepSeek — then native `json_object`
 * becomes viable and phase 2 could drop injection.
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

    // Phase 1: the tool loop persists task/fact state (update_tasks/update_facts). NO structuredOutput
    // here — Mastra runs its structuring pass over the loop's FINAL text, and a loop that saturates the
    // step budget ends on a tool call with empty text → `object` undefined → the old 3× whole-loop
    // retry (the ~95-210s latency). We run the loop once and structure separately.
    const tools = buildTools(ctx, db, def.tools);
    const loopAgent = new Agent({
      id: 'chef-reasoning',
      name: 'chef-reasoning',
      instructions: 'You are the reasoning half of a private chef. Call update_tasks/update_facts to persist what the household tells you, then briefly summarise what you recorded and what to ask next.',
      model,
      tools: Object.fromEntries(tools.map((t) => [t.id, t.asMastraTool()])),
    });
    let loopText = '';
    try {
      const loop = await loopAgent.generate(briefing, {
        stopWhen: ({ steps }: { steps: unknown[] }) => steps.length >= MAX_STEPS,
      });
      loopText = (loop as { text?: string }).text ?? '';
    } catch (err) {
      console.warn('[chef] reasoning tool loop threw:', (err as Error)?.message);
    }

    // Phase 2: one TOOL-FREE structured pass over phase 1's work → the DeliberationResult. Tool-free +
    // structuredOutput is the fast (~2.5s), reliable (0-undefined) path. jsonPromptInjection stays —
    // DeepSeek rejects the json_schema response_format Mastra sends natively for this model.
    const voiceAgent = new Agent({
      id: 'chef-reasoning-structured',
      name: 'chef-reasoning-structured',
      instructions: 'You are the reasoning half of a private chef. Emit only the deliberation result as JSON — never call tools.',
      model,
    });
    let out: ReasoningOutput | null = null;
    try {
      const res = await voiceAgent.generate(
        `${briefing}\n\nWhat you did this turn:\n${loopText || '(state was persisted via tools)'}\n\nReturn the deliberation result now: communicate what you recorded or confirmed, and ask any question that advances the objective.`,
        { structuredOutput: { schema: ReasoningOutputSchema, jsonPromptInjection: true } },
      );
      out = ReasoningOutputSchema.safeParse((res as { object: unknown }).object).data ?? null;
    } catch (err) {
      console.warn('[chef] reasoning structured pass threw:', (err as Error)?.message);
    }
    if (!out) {
      console.warn('[chef] reasoning: structured pass failed; returning an empty result.');
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
