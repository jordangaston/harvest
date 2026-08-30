import { z } from 'zod';

// Domain model for a household (iMessage increment 2). Members link via
// household_members; name lives here, owner is a user id.
export const HouseholdSchema = z.object({
  id: z.string().uuid(),
  name: z.string().nullable(),
  ownerUserId: z.string().uuid(),
  createdAt: z.date(),
});

export type Household = z.infer<typeof HouseholdSchema>;
