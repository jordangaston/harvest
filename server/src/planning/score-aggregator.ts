import type { ScoreAggregator } from './types.js';

/** Single-user (v1): identity — one member, so the aggregate is that member's score. The seam
 * (design D-04) so LeastMisery/Average/Fairness drop in for households without touching the fillers. */
export class SingleUserAggregator implements ScoreAggregator {
  static create(): SingleUserAggregator {
    return new SingleUserAggregator();
  }
  aggregate(memberScores: number[]): number {
    return memberScores[0] ?? 0;
  }
}
