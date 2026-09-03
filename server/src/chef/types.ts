import { z } from 'zod';
import { Emoji } from '@spectrum-ts/core';

/** A structured payload from deliberation too rich for a sentence — rendered deterministically
 *  through an existing send path (`richlink` → the `[richlink:<url>]` body). Extend later with
 *  `meal_plan`, `recipe_card`, etc. as new kinds, never a reshaped payload. */
export const ArtifactSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('richlink'), url: z.string() }),
]);

export type Artifact = z.infer<typeof ArtifactSchema>;

/**
 * The reasoner's output — the contract the deliberate tool hands the responder supervisor, never
 * prose. `communicate` are the points to convey this turn (facts, confirmations, the upshot of deep
 * thinking); `ask` are questions to advance the objective (0+); `artifacts` are structured payloads
 * the supervisor renders deterministically. The supervisor owns voice — this carries facts, not
 * phrasing (design §Modules).
 */
export const DeliberationResultSchema = z.object({
  communicate: z.array(z.string()).default([]),
  ask: z.array(z.string()).default([]),
  artifacts: z.array(ArtifactSchema).optional(),
});

export type DeliberationResult = z.infer<typeof DeliberationResultSchema>;

/**
 * The reasoning agent's structured output — a `DeliberationResult`. Task/fact writes happen in-loop
 * through the `update_tasks`/`update_facts` tools (WI-3b), so the result no longer declares them.
 */
export const ReasoningOutputSchema = z.object({
  result: DeliberationResultSchema,
});

export type ReasoningOutput = z.infer<typeof ReasoningOutputSchema>;

/** True when a `DeliberationResult` carries nothing to voice — the supervisor short-circuits to
 *  `[]` events before any render call (matches the reasoner's empty-plan branch; AC-4). */
export function isEmptyDeliberation(result: DeliberationResult): boolean {
  return result.communicate.length === 0 && result.ask.length === 0 && (result.artifacts?.length ?? 0) === 0;
}

export const TAPBACK_EMOJIS = ['love', 'like', 'dislike', 'laugh', 'emphasize', 'question'] as const;

export type TapbackKind = (typeof TAPBACK_EMOJIS)[number];

/** The six native iMessage tapback kinds → their Spectrum `Emoji` glyphs. `reaction(glyph, target)`
 *  takes the glyph; iMessage maps it back to the native tapback. The event carries the KIND; the
 *  consumer resolves it to a glyph here before persisting/sending. */
export const TAPBACK_GLYPHS: Record<TapbackKind, string> = {
  love: Emoji.redHeart,
  like: Emoji.thumbsUp,
  dislike: Emoji.thumbsDown,
  laugh: Emoji.faceWithTearsOfJoy,
  emphasize: Emoji.doubleExclamationMark,
  question: Emoji.redQuestionMark,
};

/** The tapback kinds Chef is allowed to send — warm affirmation, humor, excitement. Never like
 *  (thumbs-up reads passive-aggressive to Gen Z) or dislike. Enforced in code, not just the prompt
 *  (chef-tapback-emoji-style.md). */
export const CHEF_TAPBACK_KINDS = ['love', 'laugh', 'emphasize'] as const satisfies readonly TapbackKind[];

/**
 * One outbound iMessage effect the response component (WI-05) emits and WI-06's outbox sends:
 * a `text` bubble or a `tapback` reaction on a specific inbound message. (A `reply` variant may
 * exist for threaded replies but is not emitted this increment — onboarding is iMessage-only.)
 */
export type ChatEvent =
  | { kind: 'text'; text: string }
  | { kind: 'tapback'; target: string; emoji: TapbackKind }
  | { kind: 'richlink'; url: string };

export type ChatEvents = ChatEvent[];
