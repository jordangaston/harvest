import { z } from 'zod';

/**
 * The reasoning component's output — the contract it hands the response component (WI-05),
 * never prose. `intents` are the things to convey this turn in order; `must_say` are safety
 * consequences that must appear verbatim in meaning; `address` directs the turn at one member.
 * The response component owns voice — this carries facts, not phrasing (design §ReplyPlan).
 */
export const IntentSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ask'), question: z.string() }),
  z.object({ kind: z.literal('confirm'), fact: z.string() }),
  z.object({ kind: z.literal('acknowledge'), note: z.string() }),
  z.object({ kind: z.literal('hand_off'), note: z.string() }),
]);

export const ReplyPlanSchema = z.object({
  intents: z.array(IntentSchema),
  must_say: z.array(z.string()).default([]),
  address: z.string().optional(),
});

export type ReplyPlan = z.infer<typeof ReplyPlanSchema>;

const SLOT_STATUSES = ['unasked', 'asked', 'filled', 'defaulted'] as const;

/**
 * The reasoning component's *declaration* that a slot changed, keyed by slot key. The turn
 * (WI-06) maps key→slotId and applies it under the code-enforced invariant (a value-bearing
 * slot becomes `filled` only if a write landed). This produces the declaration, not the apply.
 */
export const SlotUpdateSchema = z.object({
  key: z.string(),
  status: z.enum(SLOT_STATUSES),
});

export type SlotUpdate = z.infer<typeof SlotUpdateSchema>;

/** The reasoning agent's full structured output — a validated plan, never free text. */
export const ReasoningOutputSchema = z.object({
  replyPlan: ReplyPlanSchema,
  slotUpdates: z.array(SlotUpdateSchema).default([]),
});

export type ReasoningOutput = z.infer<typeof ReasoningOutputSchema>;
