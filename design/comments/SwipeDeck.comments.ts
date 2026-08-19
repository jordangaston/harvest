import type { StudyComment } from "../../components/swipe/CommentLayer";

/**
 * Durable, shared review comments for the SwipeDeck study — the frontend-architect
 * agent and human reviewers append here. Each pin anchors to the component canvas by
 * normalized coordinates (xPct/yPct ∈ 0–1, from the top-left). In-app pins a human
 * drops during review persist separately to AsyncStorage; this file is the committed
 * record. Set `status: "addressed"` once a comment is resolved.
 *
 * Cleared 2026-08-18: the frontend-architect gate (fa-1…fa-8) and Jordan's human-review
 * round were both addressed — see docs/swipe-ui/DESIGN.md changelog.
 */
export const SWIPE_DECK_COMMENTS: StudyComment[] = [];
