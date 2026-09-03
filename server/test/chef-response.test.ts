import { describe, it, expect, afterEach } from 'vitest';
import { ScriptedResponder, MastraResponder, selectResponseAgent, type SupervisorTurn } from '../src/chef/response-agent.js';
import { CHEF_TAPBACK_KINDS, type DeliberationResult } from '../src/chef/types.js';

/** A SupervisorTurn whose `deliberate` thunk returns a fixed result and records that it ran. */
function turn(overrides: Partial<SupervisorTurn> & { result?: DeliberationResult } = {}): SupervisorTurn & { deliberated: () => boolean } {
  let ran = false;
  const result = overrides.result ?? { communicate: [], ask: [] };
  return {
    transcriptWindow: overrides.transcriptWindow ?? [],
    objectiveSummary: overrides.objectiveSummary ?? 'onboarding',
    triggerExternalId: overrides.triggerExternalId ?? null,
    deliberate: overrides.deliberate ?? (async () => { ran = true; return result; }),
    deliberated: () => ran,
  };
}

describe('ScriptedResponder — task turn (deterministic, no network)', () => {
  const responder = new ScriptedResponder(); // task by default

  it('renders one text per communicate line and ask question, in order (AC-2, Test Case 2)', async () => {
    const t = turn({ result: { communicate: ['noting peanuts as a severe allergy for Sam'], ask: ['which store do you shop at?'] } });
    const events = await responder.respond(t);
    expect(t.deliberated()).toBe(true);
    expect(events).toEqual([
      { kind: 'text', text: 'noting peanuts as a severe allergy for Sam' },
      { kind: 'text', text: 'which store do you shop at?' },
    ]);
  });

  it('empty deliberation degrades to no events (AC-4, Test Case 3)', async () => {
    const events = await responder.respond(turn({ result: { communicate: [], ask: [] } }));
    expect(events).toEqual([]);
  });

  it('renders an artifact as a richlink event (AC-2, Test Case 4)', async () => {
    const t = turn({ result: { communicate: ["here's a recipe"], ask: [], artifacts: [{ kind: 'richlink', url: 'https://x/y' }] } });
    const events = await responder.respond(t);
    expect(events).toContainEqual({ kind: 'richlink', url: 'https://x/y' });
  });
});

describe('ScriptedResponder — social turn (no delegation, no network)', () => {
  const responder = new ScriptedResponder(true); // social

  it('reacts on a real trigger id with an allowed kind and never delegates (AC-1, AC-7)', async () => {
    const t = turn({ triggerExternalId: 'spc-msg-REAL' });
    const events = await responder.respond(t);
    expect(t.deliberated()).toBe(false); // the reasoner is never invoked
    expect(events).toEqual([{ kind: 'tapback', target: 'spc-msg-REAL', emoji: 'love' }]);
    const tapback = events[0]!;
    if (tapback.kind === 'tapback') expect(CHEF_TAPBACK_KINDS as readonly string[]).toContain(tapback.emoji);
  });

  it('a null trigger id degrades to a text bubble, never a tapback (AC-7, Test Case 6)', async () => {
    const events = await new ScriptedResponder(true).respond(turn({ triggerExternalId: null }));
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe('text');
  });

  it('the never-thumbs-up rule is structural — the allowed set excludes like and dislike', () => {
    expect(CHEF_TAPBACK_KINDS).not.toContain('like');
    expect(CHEF_TAPBACK_KINDS).not.toContain('dislike');
    expect([...CHEF_TAPBACK_KINDS].sort()).toEqual(['emphasize', 'laugh', 'love']);
  });
});

describe('selectResponseAgent (env gate, no network)', () => {
  const prev = process.env.DEEPSEEK_API_KEY;
  afterEach(() => {
    if (prev === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = prev;
  });

  it('AC-6: absent key -> scripted stub; present key -> real Mastra agent', () => {
    delete process.env.DEEPSEEK_API_KEY;
    expect(selectResponseAgent()).toBeInstanceOf(ScriptedResponder);
    process.env.DEEPSEEK_API_KEY = 'test-key-no-network';
    expect(selectResponseAgent()).toBeInstanceOf(MastraResponder);
  });
});
