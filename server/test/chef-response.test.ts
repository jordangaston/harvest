import { describe, it, expect, afterEach } from 'vitest';
import { ScriptedResponder, MastraResponder, selectResponseAgent, sendEvent, type SupervisorTurn } from '../src/chef/response-agent.js';
import { CHEF_TAPBACK_KINDS, type ChatEvent, type DeliberationResult } from '../src/chef/types.js';

/** A SupervisorTurn whose `deliberate` thunk returns a fixed result and records that it ran, and
 *  whose `send` sink collects the events the responder flushes (increment 2: sends are live). */
function turn(overrides: Partial<SupervisorTurn> & { result?: DeliberationResult } = {}): SupervisorTurn & { deliberated: () => boolean; sent: ChatEvent[] } {
  let ran = false;
  const sent: ChatEvent[] = [];
  const result = overrides.result ?? { communicate: [], ask: [] };
  return {
    transcriptWindow: overrides.transcriptWindow ?? [],
    objectiveSummary: overrides.objectiveSummary ?? 'onboarding',
    triggerExternalId: overrides.triggerExternalId ?? null,
    deliberate: overrides.deliberate ?? (async () => { ran = true; return result; }),
    send: overrides.send ?? (async (e) => { sent.push(e); }),
    deliberated: () => ran,
    sent,
  };
}

describe('ScriptedResponder — task turn (deterministic, no network)', () => {
  const responder = new ScriptedResponder(); // task by default

  it('sends one text per communicate line and ask question, in order (AC-2, Test Case 2)', async () => {
    const t = turn({ result: { communicate: ['noting peanuts as a severe allergy for Sam'], ask: ['which store do you shop at?'] } });
    await responder.respond(t);
    expect(t.deliberated()).toBe(true);
    expect(t.sent).toEqual([
      { kind: 'text', text: 'noting peanuts as a severe allergy for Sam' },
      { kind: 'text', text: 'which store do you shop at?' },
    ]);
  });

  it('empty deliberation degrades to no sends (AC-4, Test Case 3)', async () => {
    const t = turn({ result: { communicate: [], ask: [] } });
    await responder.respond(t);
    expect(t.sent).toEqual([]);
  });

  it('sends an artifact as a richlink event (AC-2, Test Case 4)', async () => {
    const t = turn({ result: { communicate: ["here's a recipe"], ask: [], artifacts: [{ kind: 'richlink', url: 'https://x/y' }] } });
    await responder.respond(t);
    expect(t.sent).toContainEqual({ kind: 'richlink', url: 'https://x/y' });
  });
});

describe('ScriptedResponder — social turn (no delegation, no network)', () => {
  it('sends a tapback on a real trigger and never delegates (AC-1)', async () => {
    const responder = new ScriptedResponder({ deliberate: false, send: [{ type: 'tapback' }] });
    const t = turn({ triggerExternalId: 'spc-msg-REAL' });
    await responder.respond(t);
    expect(t.deliberated()).toBe(false); // the reasoner is never invoked
    expect(t.sent).toEqual([{ kind: 'tapback', target: 'spc-msg-REAL', emoji: 'love' }]);
  });

  it('sends a warm social line without delegating (AC-1 — the motivating example)', async () => {
    const responder = new ScriptedResponder({ deliberate: false, send: [{ type: 'text', text: 'I know right! 😁' }] });
    const t = turn({ triggerExternalId: 'spc-msg-REAL' });
    await responder.respond(t);
    expect(t.deliberated()).toBe(false);
    expect(t.sent).toEqual([{ kind: 'text', text: 'I know right! 😁' }]);
  });
});

describe('sendEvent grounding (AC-7)', () => {
  it('a tapback grounds only on a real trigger id — never a bogus target', () => {
    expect(sendEvent({ type: 'tapback' }, 'spc-REAL')).toEqual({ kind: 'tapback', target: 'spc-REAL', emoji: 'love' });
    expect(sendEvent({ type: 'tapback' }, null)).toBeNull(); // no trigger ⇒ no tapback (the model sends text instead)
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
