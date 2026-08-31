import { z } from 'zod';

// Domain model for a household member (iMessage increment 2) — a pure link. Name →
// users.name, handle → users.imessage_handle; the link never duplicates them.
export const HouseholdMemberSchema = z.object({
  id: z.string().uuid(),
  householdId: z.string().uuid(),
  userId: z.string().uuid(),
});

export type HouseholdMember = z.infer<typeof HouseholdMemberSchema>;
