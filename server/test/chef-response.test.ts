import { describe, it, expect, afterEach } from 'vitest';
import { ScriptedResponder, MastraResponder, selectResponseAgent } from '../src/chef/response-agent.js';
import { CHEF_TAPBACK_KINDS, type ReplyPlan } from '../src/chef/types.js';

const responder = new ScriptedResponder();

describe('ScriptedResponder.render (deterministic, no network)', () => {
  it('AC-1: one text event per conveyable intent, in order', async () => {
    const plan: ReplyPlan = {
      intents: [
        { kind: 'confirm', fact: "Kroger's in." },
        { kind: 'ask', question: 'What days do you usually cook?' },
      ],
      must_say: [],
    };
    const events = await responder.render(plan, ['we shop at kroger']);
    expect(events).toEqual([
      { kind: 'text', text: "Kroger's in." },
      { kind: 'text', text: 'What days do you usually cook?' },
    ]);
  });

  it('AC-2: an acknowledge intent addressing a message renders an allowed-kind tapback (never like)', async () => {
    const plan: ReplyPlan = { intents: [{ kind: 'acknowledge', note: 'got it' }], must_say: [], address: 'guid-1' };
    const events = await responder.render(plan, []);
    expect(events).toEqual([{ kind: 'tapback', target: 'guid-1', emoji: 'love' }]);
  });

  it('AC-3: every must_say surfaces as a text event', async () => {
    const plan: ReplyPlan = { intents: [], must_say: ['peanuts never enter this kitchen'] };
    const events = await responder.render(plan, []);
    expect(events).toContainEqual({ kind: 'text', text: 'peanuts never enter this kitchen' });
  });

  it('AC-5: a fresh collector per call — the second render omits the first\'s bubbles', async () => {
    const planA: ReplyPlan = { intents: [{ kind: 'confirm', fact: 'A' }], must_say: [] };
    const planB: ReplyPlan = { intents: [{ kind: 'confirm', fact: 'B' }], must_say: [] };
    const a = await responder.render(planA, []);
    const b = await responder.render(planB, []);
    expect(a).toEqual([{ kind: 'text', text: 'A' }]);
    expect(b).toEqual([{ kind: 'text', text: 'B' }]);
  });
});

// WI-4A AC3: MastraResponder grounds a tapback on a REAL trigger id, of an allowed kind, never
// like/dislike. The tapback path returns before any model call, so these run offline (no key).
describe('MastraResponder tapback emission (WI-4A, grounded, no network)', () => {
  const responder = MastraResponder.create('test-key-no-network');

  it('AC3: an addressed acknowledge plan reacts on the real trigger id with an allowed kind', async () => {
    const plan: ReplyPlan = { intents: [{ kind: 'acknowledge', note: 'got it' }], must_say: [], address: 'model-said-X' };
    const events = await responder.render(plan, ['sounds good'], 'spc-msg-REAL');

    // Grounded on the trigger id, NOT the model's address string; kind is allowed (never like/dislike).
    expect(events).toEqual([{ kind: 'tapback', target: 'spc-msg-REAL', emoji: 'love' }]);
    const tapback = events[0]!;
    if (tapback.kind === 'tapback') expect(CHEF_TAPBACK_KINDS as readonly string[]).toContain(tapback.emoji);
  });

  it('AC3: the never-thumbs-up rule is structural — the allowed set excludes like and dislike', () => {
    expect(CHEF_TAPBACK_KINDS).not.toContain('like');
    expect(CHEF_TAPBACK_KINDS).not.toContain('dislike');
    expect([...CHEF_TAPBACK_KINDS].sort()).toEqual(['emphasize', 'laugh', 'love']);
  });
});

describe('selectResponseAgent (env gate, no network)', () => {
  const prev = process.env.GROQ_API_KEY;
  afterEach(() => {
    if (prev === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = prev;
  });

  it('AC-6: absent key -> scripted stub; present key -> real Mastra agent', () => {
    delete process.env.GROQ_API_KEY;
    expect(selectResponseAgent()).toBeInstanceOf(ScriptedResponder);
    process.env.GROQ_API_KEY = 'test-key-no-network';
    expect(selectResponseAgent()).toBeInstanceOf(MastraResponder);
  });
});
