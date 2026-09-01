import { describe, it, expect } from 'vitest';
import { StubSpectrumSender } from '../src/imessage/sender.js';

describe('Sender.sendReply (StubSpectrumSender)', () => {
  it('threads to a resolved target and returns the sent ids in order (AC1)', async () => {
    const sender = new StubSpectrumSender();

    const ids = await sender.sendReply('chat-1', 'spc-msg-PARENT', ['hi']);

    expect(ids).toEqual(['ext-0']);
    expect(sender.replyCalls).toEqual([{ chatGuid: 'chat-1', target: 'spc-msg-PARENT', body: 'hi' }]);
  });

  it('falls back (target null) when the parent does not resolve — still delivers, no throw (AC2)', async () => {
    const sender = new StubSpectrumSender();
    sender.missingTargets.add('missing');

    const ids = await sender.sendReply('chat-1', 'missing', ['hi']);

    expect(ids).toEqual(['ext-0']);
    expect(sender.replyCalls).toEqual([{ chatGuid: 'chat-1', target: null, body: 'hi' }]);
  });
});

describe('Sender.sendReaction (StubSpectrumSender)', () => {
  it('records a resolved reaction (WI-4A AC1)', async () => {
    const sender = new StubSpectrumSender();
    await sender.sendReaction('chat-1', 'spc-msg-X', '❤️');
    expect(sender.reactionCalls).toEqual([{ chatGuid: 'chat-1', target: 'spc-msg-X', emoji: '❤️' }]);
  });

  it('no-ops on an unresolvable target — no throw, nothing recorded (WI-4A AC2)', async () => {
    const sender = new StubSpectrumSender();
    sender.missingTargets.add('missing');
    await expect(sender.sendReaction('chat-1', 'missing', '❤️')).resolves.toBeUndefined();
    expect(sender.reactionCalls).toEqual([]);
  });
});
