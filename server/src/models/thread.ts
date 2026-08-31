import { z } from 'zod';

// Domain model for an iMessage thread (increment 1). Repositories parse rows into
// this at the boundary. `lastProcessedId` is the cursor: the newest inbound message
// already handled, null until the first turn runs.
export const ThreadSchema = z.object({
  id: z.string().uuid(),
  chatGuid: z.string(),
  ownerUserId: z.string().uuid(),
  householdId: z.string().nullable(),
  lastProcessedId: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type Thread = z.infer<typeof ThreadSchema>;
