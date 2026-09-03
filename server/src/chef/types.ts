import { Emoji } from '@spectrum-ts/core';

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
