import { z } from 'zod';

const TASK_KINDS = ['elicit', 'emit'] as const;
const TASK_SCOPES = ['household', 'member'] as const;
const TASK_STATUSES = ['unasked', 'asked', 'filled', 'defaulted'] as const;

// Domain model for one task of an objective (objective-system v2). An `elicit` task points at
// a fact (key + type) and carries no value; an `emit` task delivers information (null fact). A
// household-scoped task has memberUserId null; a member-scoped one names the member. `afterTaskIds`
// is the ordering gate — the task is eligible only when every listed task is terminal.
export const TaskSchema = z.object({
  id: z.string().uuid(),
  objectiveId: z.string().uuid(),
  kind: z.enum(TASK_KINDS),
  fact: z.string().nullable(),
  factType: z.string().nullable(),
  scope: z.enum(TASK_SCOPES),
  memberUserId: z.string().uuid().nullable(),
  required: z.boolean(),
  status: z.enum(TASK_STATUSES),
  solo: z.boolean(),
  afterTaskIds: z.array(z.string()),
  followUpsSent: z.number().int(),
});

export type Task = z.infer<typeof TaskSchema>;
