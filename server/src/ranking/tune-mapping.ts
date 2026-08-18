import type { SWIPE_REASONS } from '../schema.js';

type SwipeReason = (typeof SWIPE_REASONS)[number];

/** The weight signal a reason nudges (the `user_preferences` column). */
export type TuneSignal = 'cost' | 'difficulty' | 'time' | 'nutrition';

/** What a dislike reason does: bump a weight, add a food-pref dislike, or nothing. */
export type TuneAction = { kind: 'weight'; signal: TuneSignal } | { kind: 'dislike' } | { kind: 'none' };

const REASON_ACTIONS: Record<SwipeReason, TuneAction> = {
  too_expensive: { kind: 'weight', signal: 'cost' },
  too_hard: { kind: 'weight', signal: 'difficulty' },
  too_slow: { kind: 'weight', signal: 'time' },
  not_nutritious: { kind: 'weight', signal: 'nutrition' },
  disliked_ingredient: { kind: 'dislike' },
  other: { kind: 'none' },
};

/** Maps a dislike reason to its tuning action (pure). */
export function tuneActionFor(reason: SwipeReason): TuneAction {
  return REASON_ACTIONS[reason];
}
