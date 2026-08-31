import { z } from 'zod';

const SLOT_SCOPES = ['household', 'member'] as const;
const SLOT_STATUSES = ['unasked', 'asked', 'filled', 'defaulted'] as const;

// Domain model for a slot on an objective's scoreboard (iMessage increment 2). A
// household-scoped slot has memberUserId null; a member-scoped one names the member.
export const SlotSchema = z.object({
  id: z.string().uuid(),
  objectiveId: z.string().uuid(),
  key: z.string(),
  scope: z.enum(SLOT_SCOPES),
  memberUserId: z.string().uuid().nullable(),
  required: z.boolean(),
  status: z.enum(SLOT_STATUSES),
  value: z.unknown().nullable(),
  followUpsSent: z.number().int(),
  followUpTimerId: z.string().nullable(),
});

export type Slot = z.infer<typeof SlotSchema>;
