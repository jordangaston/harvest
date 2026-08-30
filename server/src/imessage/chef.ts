import { fetchWithRetry } from '../parse/http.js';

const DEEPSEEK_CHAT_URL = 'https://api.deepseek.com/chat/completions';
// ponytail: swap the id if DeepSeek renames it (matches parse/extractor.ts).
const CHEF_MODEL = 'deepseek-v4-flash';

const PERSONA_PROMPT =
  'You are the Harvest private chef: warm, concise, and encouraging, texting a home cook over ' +
  'iMessage. Reply in one or two short, natural sentences — never a list, never markdown. Be a ' +
  'friendly guide, not a search box.';

/** What the chef sees for one turn: the pending inbound texts, oldest first. */
export interface ChefContext {
  messages: string[];
}

/** The reasoning layer's structured result. Increment 1: always "no actions — converse". */
export interface ReasoningResult {
  actions: string[];
  facts: string[];
  summary: string;
}

/**
 * The reasoning layer (D1/D4): the seam increment 2 fills with objective machinery.
 * Increment 1 is a stub — it decides nothing, it just returns the converse summary.
 */
export class ReasoningLayer {
  async processMessage(_ctx: ChefContext): Promise<ReasoningResult> {
    return { actions: [], facts: [], summary: 'no actions — converse' };
  }
}

/** The outer response layer (D1): MUST call the reasoning layer before composing a reply. */
export interface Chef {
  respond(ctx: ChefContext): Promise<string>;
}

/**
 * Live response layer. Enforces the response→reasoning seam (AC-8): it calls
 * `reasoning.processMessage` first, then makes one DeepSeek persona call to compose
 * the reply (following the extractor.ts pattern — fetchWithRetry, thinking disabled).
 */
export class ResponseLayer implements Chef {
  constructor(
    private readonly apiKey: string,
    private readonly reasoning: ReasoningLayer,
  ) {}

  static create(): ResponseLayer {
    return new ResponseLayer(process.env.DEEPSEEK_API_KEY!, new ReasoningLayer());
  }

  async respond(ctx: ChefContext): Promise<string> {
    // The seam: reasoning runs before any reply is composed.
    const reasoning = await this.reasoning.processMessage(ctx);
    const res = await fetchWithRetry(DEEPSEEK_CHAT_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: CHEF_MODEL,
        thinking: { type: 'disabled' },
        messages: [
          { role: 'system', content: `${PERSONA_PROMPT}\n\nReasoning: ${reasoning.summary}` },
          { role: 'user', content: ctx.messages.join('\n') },
        ],
      }),
    });
    if (!res.ok) throw new Error(`Chef reply failed — HTTP ${res.status}`);
    const json = (await res.json()) as { choices: Array<{ message: { content: string } }> };
    return json.choices[0]?.message.content ?? '';
  }
}

/** Dev/test double: a fixed reply that still exercises the reasoning seam. */
export class StubChef implements Chef {
  readonly reasoning = new ReasoningLayer();
  reasoningReached = false;

  async respond(ctx: ChefContext): Promise<string> {
    await this.reasoning.processMessage(ctx);
    this.reasoningReached = true;
    return "Hey! I'm your Harvest chef — what are you in the mood to cook?";
  }
}

/** The chef for the current env: live when DEEPSEEK_API_KEY is set, else the stub. */
export function selectChef(): Chef {
  return process.env.DEEPSEEK_API_KEY ? ResponseLayer.create() : new StubChef();
}
