import { z } from 'zod';

const OBJECTIVE_STATUSES = ['active', 'suspended', 'complete'] as const;

// Domain model for an objective on the stack (iMessage increment 2). `stackPosition`
// orders the stack (active = max); `completedAt` set only on pop.
export const ObjectiveSchema = z.object({
  id: z.string().uuid(),
  threadId: z.string().uuid(),
  definition: z.string(),
  status: z.enum(OBJECTIVE_STATUSES),
  stackPosition: z.number().int(),
  context: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.date(),
  completedAt: z.date().nullable(),
});

export type Objective = z.infer<typeof ObjectiveSchema>;
