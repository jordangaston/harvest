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
 * envelope is loose (extra fields preserved); a text body rides at `content.text`
 * (the `text` content arm is `{ type: "text", text }`) and a tapback rides at
 * `content.emoji` + `content.target.id` (the `reaction` arm) — confirmed against the SDK.
 * @param rawBody - The exact bytes received on the wire.
 */
export function parseInbound(rawBody: Uint8Array): InboundMessage {
  const { message } = slimEnvelopeSchema.parse(JSON.parse(new TextDecoder().decode(rawBody)));
  const content = message.content as { type: string; text?: unknown; emoji?: unknown; target?: { id?: unknown } };
  return {
    messageGuid: message.id,
    chatGuid: message.space.id,
    handle: message.sender?.id ?? '',
    type: content.type,
    body: typeof content.text === 'string' ? content.text : null,
    reactionEmoji: content.type === 'reaction' && typeof content.emoji === 'string' ? content.emoji : undefined,
    targetGuid: content.type === 'reaction' && typeof content.target?.id === 'string' ? content.target.id : undefined,
  };
}
