import { slimEnvelopeSchema } from '@spectrum-ts/core/webhook';

/** The fields the substrate records from a native Spectrum inbound delivery. */
export interface InboundMessage {
  messageGuid: string;
  chatGuid: string;
  handle: string;
  type: string;
  body: string | null;
  // Reaction (tapback) arm only: the emoji and the guid of the message it reacts to.
  reactionEmoji?: string;
  targetGuid?: string;
}

/**
 * Parses a raw Spectrum webhook body into the fields the substrate persists. The
 * envelope is loose (extra fields preserved). A text body rides at `content.text`
 * (the `text` arm is `{ type: "text", text }`); a tapback rides at `content.emoji` +
 * `content.target.id` (the `reaction` arm); a threaded reply wraps its own content at
 * `content.content` and points at its parent via `content.target.id` (the `reply` arm
 * is `{ type: "reply", content: <nested arm, e.g. text>, target: Message }`) — confirmed
 * against the SDK. A reply's own text is the nested arm's `text`, and its `targetGuid` is
 * the PARENT message guid, so the reply flows to reasoning like a normal turn with a referent.
 * @param rawBody - The exact bytes received on the wire.
 */
export function parseInbound(rawBody: Uint8Array): InboundMessage {
  const { message } = slimEnvelopeSchema.parse(JSON.parse(new TextDecoder().decode(rawBody)));
  const content = message.content as {
    type: string;
    text?: unknown;
    emoji?: unknown;
    target?: { id?: unknown };
    content?: { text?: unknown };
  };
  const reply = content.type === 'reply';
  const body = reply
    ? typeof content.content?.text === 'string' ? content.content.text : null
    : typeof content.text === 'string' ? content.text : null;
  return {
    messageGuid: message.id,
    chatGuid: message.space.id,
    handle: message.sender?.id ?? '',
    type: content.type,
    body,
    reactionEmoji: content.type === 'reaction' && typeof content.emoji === 'string' ? content.emoji : undefined,
    // Both the reaction and reply arms carry a `target.id` — the reacted-to / replied-to parent guid.
    targetGuid:
      (content.type === 'reaction' || reply) && typeof content.target?.id === 'string' ? content.target.id : undefined,
  };
}
