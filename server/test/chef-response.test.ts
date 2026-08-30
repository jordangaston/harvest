import { describe, it, expect, afterEach } from 'vitest';
import { ScriptedResponder, MastraResponder, selectResponseAgent } from '../src/chef/response-agent.js';
import type { ReplyPlan } from '../src/chef/types.js';

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

  it('AC-2: an acknowledge intent addressing a message renders a tapback', async () => {
    const plan: ReplyPlan = { intents: [{ kind: 'acknowledge', note: 'got it' }], must_say: [], address: 'guid-1' };
    const events = await responder.render(plan, []);
    expect(events).toEqual([{ kind: 'tapback', target: 'guid-1', emoji: 'like' }]);
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

describe('selectResponseAgent (env gate, no network)', () => {
  const prev = process.env.DEEPSEEK_API_KEY;
  afterEach(() => {
    if (prev === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = prev;
  });

  it('AC-6: absent key → scripted stub; present key → real Mastra agent', () => {
    delete process.env.DEEPSEEK_API_KEY;
    expect(selectResponseAgent()).toBeInstanceOf(ScriptedResponder);
    process.env.DEEPSEEK_API_KEY = 'test-key-no-network';
    expect(selectResponseAgent()).toBeInstanceOf(MastraResponder);
  });
});
