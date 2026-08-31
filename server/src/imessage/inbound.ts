import { slimEnvelopeSchema } from '@spectrum-ts/core/webhook';

/** The fields the substrate records from a native Spectrum inbound delivery. */
export interface InboundMessage {
  messageGuid: string;
  chatGuid: string;
  handle: string;
  type: string;
  body: string | null;
}

/**
 * Parses a raw Spectrum webhook body into the fields the substrate persists. The
 * envelope is loose (extra fields preserved); a text body rides at `content.text`
 * (the `text` content arm is `{ type: "text", text }` — confirmed against the SDK).
 * @param rawBody - The exact bytes received on the wire.
 */
export function parseInbound(rawBody: Uint8Array): InboundMessage {
  const { message } = slimEnvelopeSchema.parse(JSON.parse(new TextDecoder().decode(rawBody)));
  const content = message.content as { type: string; text?: unknown };
  return {
    messageGuid: message.id,
    chatGuid: message.space.id,
    handle: message.sender?.id ?? '',
    type: content.type,
    body: typeof content.text === 'string' ? content.text : null,
  };
}
