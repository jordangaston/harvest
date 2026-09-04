import { describe, it, expect, afterEach } from 'vitest';
import { ScriptedChefAgent, MastraChefAgent, selectChefAgent, sendEvent, type ChefTurn } from '../src/chef/chef-agent.js';
import { CHEF_TAPBACK_KINDS, type ChatEvent } from '../src/chef/types.js';
import type { BriefingInput } from '../src/chef/briefing.js';
import type { TurnContext } from '../src/chef/tools/types.js';

/** A minimal ChefTurn whose `send` sink records the events the agent flushes (sends are live). The
 *  briefing carries a registered onboarding objective so `prepareBriefing` doesn't throw. */
function turn(overrides: Partial<ChefTurn> = {}): ChefTurn & { sent: ChatEvent[] } {
  const sent: ChatEvent[] = [];
  const briefing: BriefingInput = {
    objective: { id: 'o1', threadId: 't1', definition: 'onboarding', status: 'active', stackPosition: 0 } as BriefingInput['objective'],
    tasks: [],
    members: [],
    transcript: [{ role: 'household', text: 'hi' }],
    trigger: 'hi',
  };
  return {
    briefing: overrides.briefing ?? briefing,
    ctx: overrides.ctx ?? ({} as TurnContext),
    triggerExternalId: overrides.triggerExternalId ?? null,
    messageTargets: overrides.messageTargets ?? {},
    send: overrides.send ?? (async (e) => { sent.push(e); }),
    sent,
  };
}

describe('ScriptedChefAgent — working turn (mutated, no network)', () => {
  it('reports worked and flushes its scripted sends (AC-5)', async () => {
    const agent = new ScriptedChefAgent({ mutate: true, send: [{ type: 'text', text: 'noting peanuts' }, { type: 'text', text: 'which store?' }] });
    const t = turn();
    const { worked } = await agent.run(t, {} as never);
    expect(worked).toBe(true);
    expect(t.sent).toEqual([
      { kind: 'text', text: 'noting peanuts' },
      { kind: 'text', text: 'which store?' },
    ]);
  });
});

describe('ScriptedChefAgent — social turn (no work, no network)', () => {
  it('sends a tapback on a real trigger and reports no work (AC-5)', async () => {
    const agent = new ScriptedChefAgent({ mutate: false, send: [{ type: 'tapback' }] });
    const t = turn({ triggerExternalId: 'spc-msg-REAL' });
    const { worked } = await agent.run(t, {} as never);
    expect(worked).toBe(false); // a social turn confirms nothing
    expect(t.sent).toEqual([{ kind: 'tapback', target: 'spc-msg-REAL', emoji: 'love' }]);
  });

  it('an empty turn (no send, no work) degrades to nothing', async () => {
    const agent = new ScriptedChefAgent({ mutate: false, send: [] });
    const t = turn();
    const { worked } = await agent.run(t, {} as never);
    expect(worked).toBe(false);
    expect(t.sent).toEqual([]);
  });
});

describe('sendEvent grounding', () => {
  it('a tapback grounds only on a real trigger id — never a bogus target', () => {
    expect(sendEvent({ type: 'tapback' }, 'spc-REAL')).toEqual({ kind: 'tapback', target: 'spc-REAL', emoji: 'love' });
    expect(sendEvent({ type: 'tapback' }, null)).toBeNull(); // no trigger ⇒ no tapback (the model sends text instead)
  });

  it('a tapback targets any message by its [m#] handle; an unknown handle grounds nowhere', () => {
    const targets = { m1: 'spc-1', m2: 'spc-2' };
    expect(sendEvent({ type: 'tapback', target: 'm2' }, 'spc-trigger', targets)).toEqual({ kind: 'tapback', target: 'spc-2', emoji: 'love' });
    // no target ⇒ default to the trigger
    expect(sendEvent({ type: 'tapback' }, 'spc-trigger', targets)).toEqual({ kind: 'tapback', target: 'spc-trigger', emoji: 'love' });
    // unknown handle ⇒ dropped, never a raw model-supplied id
    expect(sendEvent({ type: 'tapback', target: 'm9' }, 'spc-trigger', targets)).toBeNull();
  });

  it('text and richlink pass through regardless of trigger; empty content is dropped', () => {
    expect(sendEvent({ type: 'text', text: 'hi' }, null)).toEqual({ kind: 'text', text: 'hi' });
    expect(sendEvent({ type: 'richlink', url: 'https://x/y' }, null)).toEqual({ kind: 'richlink', url: 'https://x/y' });
    expect(sendEvent({ type: 'text' }, 'spc-REAL')).toBeNull();
  });

  it('the never-thumbs-up rule is structural — the allowed set excludes like and dislike', () => {
    expect(CHEF_TAPBACK_KINDS).not.toContain('like');
    expect(CHEF_TAPBACK_KINDS).not.toContain('dislike');
    expect([...CHEF_TAPBACK_KINDS].sort()).toEqual(['emphasize', 'laugh', 'love']);
  });
});

describe('selectChefAgent (env gate, no network)', () => {
  const prev = process.env.GEMINI_API_KEY;
  afterEach(() => {
    if (prev === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prev;
  });

  it('absent key -> scripted stub; present key -> real Mastra agent', () => {
    delete process.env.GEMINI_API_KEY;
    expect(selectChefAgent()).toBeInstanceOf(ScriptedChefAgent);
    process.env.GEMINI_API_KEY = 'test-key-no-network';
    expect(selectChefAgent()).toBeInstanceOf(MastraChefAgent);
  });
});
