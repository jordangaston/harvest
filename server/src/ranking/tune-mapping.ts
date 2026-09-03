import type { SWIPE_REASONS } from '../schema.js';

type SwipeReason = (typeof SWIPE_REASONS)[number];

/** What a dislike reason does: add a food-pref dislike, or nothing. The cost/time/difficulty/
 * nutrition reasons bumped the retired weight vector (WI-3); with no cost/time/difficulty/nutrient
 * *recipe-scope* directive dimension yet, they have no home this milestone and record only. They
 * become a directive nudge when WI-4 adds those dimensions. */
export type TuneAction = { kind: 'dislike' } | { kind: 'none' };

const REASON_ACTIONS: Record<SwipeReason, TuneAction> = {
  too_expensive: { kind: 'none' },
  too_hard: { kind: 'none' },
  too_slow: { kind: 'none' },
  not_nutritious: { kind: 'none' },
  disliked_ingredient: { kind: 'dislike' },
  other: { kind: 'none' },
};

/** Maps a dislike reason to its tuning action (pure). */
export function tuneActionFor(reason: SwipeReason): TuneAction {
  return REASON_ACTIONS[reason];
}
