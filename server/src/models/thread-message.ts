import { z } from 'zod';

// Domain model for one message in a thread (increment 1). `messageGuid` is Apple's
// guid (inbound, dedup) or a self-minted UUID (outbound). `sentAt` is the outbound
// send gate: null until the send resolves.
export const ThreadMessageSchema = z.object({
  id: z.string().uuid(),
  threadId: z.string().uuid(),
  direction: z.enum(['inbound', 'outbound']),
  type: z.enum(['text', 'reaction', 'reply', 'attachment']),
  senderUserId: z.string().uuid().nullable(),
  body: z.string().nullable(),
  // Reaction (tapback) substrate (WI-A): the emoji + the guid of the message reacted to.
  targetMessageGuid: z.string().nullable(),
  reactionEmoji: z.string().nullable(),
  messageGuid: z.string(),
  sentAt: z.date().nullable(),
  createdAt: z.date(),
});

export type ThreadMessage = z.infer<typeof ThreadMessageSchema>;
