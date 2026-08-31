import { Agent } from '@mastra/core/agent';
import { ToolSearchProcessor } from '@mastra/core/processors';
import { RequestContext } from '@mastra/core/request-context';
import type { OpenAICompatibleConfig } from '@mastra/core/llm';
import { prepareBriefing, type Briefing, type BriefingInput } from './briefing.js';
import { ReasoningOutputSchema, type ReasoningOutput } from './types.js';
import { TOOL_REGISTRY, canRunByName } from './tools/registry.js';
import type { SaveResult, ToolCtx } from './tools/types.js';

// ponytail: swap the id if DeepSeek renames it. Mirrors extractor.ts's EXTRACTION_MODEL.
const REASONING_MODEL = 'deepseek/deepseek-v4-flash';
const DEEPSEEK_URL = 'https://api.deepseek.com';

/** A scripted tool call: the id and the args the model would have emitted. */
export interface ScriptedCall {
  toolId: string;
  args: unknown;
}

/**
 * The reasoning half of the Chef. `run` drives the tool loop and returns a validated plan;
 * the real path is a Mastra agent, the test path a scripted reasoner (no network). Both run
 * the real tools' `execute` (canRun-guarded) so `SaveResult` and legality are exercised.
 */
export interface Reasoner {
  run(input: BriefingInput, ctx: ToolCtx): Promise<ReasoningOutput>;
}

/**
 * Test double: replays a fixed tool-call sequence + a fixed plan, running the real tools'
 * `execute` behind their `canRun` gate (an illegal call is dropped, never dispatched), and
 * re-parses the plan. Makes no network call — the LLM's judgment is a WI-08 eval, not tested here.
 */
export class ScriptedReasoner implements Reasoner {
  constructor(
    private readonly calls: ScriptedCall[],
    private readonly plan: ReasoningOutput,
  ) {}

  /** The `SaveResult`s the scripted calls landed — read by tests asserting rejects/writes. */
  results: SaveResult[] = [];

  async run(input: BriefingInput, ctx: ToolCtx): Promise<ReasoningOutput> {
    prepareBriefing(input); // exercise the pure assembly (throws on an unregistered objective)
    for (const call of this.calls) {
      const entry = TOOL_REGISTRY[call.toolId];
      // Legality is checked with the call's args in scope — a withheld-but-eligible tool is still
      // reachable (it's in the registry); an illegal call is skipped, never dispatched.
      const state = { ...ctx.state, args: call.args };
      if (!entry || !entry.canRun(state)) continue;
      const result = await entry.execute(call.args, { ...ctx, state });
      if ('saved' in result) this.results.push(result);
    }
    return ReasoningOutputSchema.parse(this.plan);
  }
}

/**
 * The live reasoning agent: a Mastra `Agent` with DeepSeek, dynamic resident tools resolved
 * per turn from the active objective (∩ canRun), the rest searchable via `ToolSearchProcessor`
 * whose `filter` maps `canRun` legality onto search/load. Structured output = a validated
 * `{ replyPlan, slotUpdates }` (never prose). Dormant until WI-06 wires the turn (WI-08 evals it).
 */
export class MastraReasoner implements Reasoner {
  constructor(private readonly agent: Agent, private readonly structurer: Agent) {}

  static create(apiKey: string): MastraReasoner {
    const model: OpenAICompatibleConfig = { id: REASONING_MODEL, url: DEEPSEEK_URL, apiKey };
    const agent = new Agent({
      id: 'chef-reasoning',
      name: 'chef-reasoning',
      instructions: ({ requestContext }) => requestContext.get('briefingPrompt') as string,
      model,
      // Resident set resolved per turn from the briefing (already ∩ canRun).
      tools: ({ requestContext }) => {
        const ids = (requestContext.get('residentToolIds') as string[] | undefined) ?? [];
        return Object.fromEntries(ids.map((id) => [id, TOOL_REGISTRY[id]!.tool]));
      },
      inputProcessors: [
        new ToolSearchProcessor({
          tools: Object.fromEntries(Object.values(TOOL_REGISTRY).map((e) => [e.id, e.tool])),
          includeResolvedTools: true,
          filter: ({ toolName, requestContext }) => canRunByName(toolName, requestContext?.get('chefState') as never),
        }),
      ],
    });
    // Second, tool-free agent that turns the working pass's notes into the structured output.
    const structurer = new Agent({
      id: 'chef-reasoning-structurer',
      name: 'chef-reasoning-structurer',
      instructions:
        'You convert a chef assistant\'s working notes into a structured reply plan. From the notes ' +
        'and the conversation, produce the intents to convey next (ask/confirm/acknowledge/hand_off), ' +
        'any must_say safety lines, and which slots are now answered. Never invent facts not in the notes.',
      model,
    });
    return new MastraReasoner(agent, structurer);
  }

  async run(input: BriefingInput, _ctx: ToolCtx): Promise<ReasoningOutput> {
    const briefing = prepareBriefing(input);
    // Pass 1 — tool-calling (the writes happen here). NO structuredOutput: DeepSeek can't combine
    // tools + structured output in one call (res.object comes back undefined on tool-using turns).
    const work = await this.agent.generate(briefing.prompt, {
      requestContext: this.context(briefing),
      stopWhen: ({ steps }: { steps: unknown[] }) => steps.length >= 6,
    });
    // Pass 2 — structure the reply. Tool-free, so structuredOutput works; jsonPromptInjection
    // because DeepSeek rejects the json_schema response_format.
    const res = await this.structurer.generate(
      `Conversation & the chef's working notes for this turn:\n${(work as { text?: string }).text ?? ''}\n\n` +
        `Unanswered slots the chef still needs: ${input.slots.map((s) => s.key).join(', ') || '(none)'}\n\n` +
        `Produce the reply plan + slot updates.`,
      { structuredOutput: { schema: ReasoningOutputSchema, jsonPromptInjection: true } },
    );
    return ReasoningOutputSchema.parse((res as { object: unknown }).object);
  }

  /** The request context the agent and the tool-search filter read (chef state + resident ids).
   * Must be a `RequestContext` instance (Mastra calls `.get()` on it), not a plain object. */
  private context(briefing: Briefing): RequestContext {
    const rc = new RequestContext();
    rc.set('chefState', briefing.requestContext.chefState);
    rc.set('briefingPrompt', briefing.prompt);
    rc.set('residentToolIds', briefing.residentTools.map((e) => e.id));
    return rc;
  }
}

/**
 * The reasoner for the current env: the live Mastra agent when `DEEPSEEK_API_KEY` is set,
 * else the offline scripted stub (empty script, empty plan). Mirrors `selectExtractor`.
 * Tests pass their own `ScriptedReasoner`; this selector is the deploy-time env gate.
 */
export function selectReasoningAgent(): Reasoner {
  if (process.env.DEEPSEEK_API_KEY) return MastraReasoner.create(process.env.DEEPSEEK_API_KEY);
  return new ScriptedReasoner([], { replyPlan: { intents: [], must_say: [] }, slotUpdates: [] });
}
