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
