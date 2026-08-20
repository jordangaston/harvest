import { ViewStyle } from "react-native";

/**
 * Elevation tokens — the shared shadow scale (the depth counterpart to lib/motion.ts).
 * Reference these instead of hand-rolling shadow values so surfaces lift consistently.
 *
 * Depth is how a light-on-light system separates surfaces: our warm neutrals (card #FBF6EC
 * on cream #F1E6D2) are only ~1.15:1 apart, so a card can't stand off the canvas by colour —
 * it needs a shadow (Refactoring UI, Ch6 "Creating Depth"). Light-from-above: a positive Y
 * offset, warm ink shadow, softening as it rises.
 */
// Shadow colour is a deep espresso (darker than ink) — a warm #2E2419 shadow on the warm
// cream canvas is too low-contrast to define an edge, so the light-on-light separation fails.
const SHADOW = "#1B1206";
export const ELEVATION = {
  /** Resting surface — small tiles, rows, chips lifting off the canvas. */
  low: { shadowColor: SHADOW, shadowOpacity: 0.16, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  /** Cards & interactive/floating — settings cards, action buttons, menus. */
  medium: { shadowColor: SHADOW, shadowOpacity: 0.2, shadowRadius: 14, shadowOffset: { width: 0, height: 7 }, elevation: 7 },
  /** Hero/overlay — the swipe card, modals over the deck. */
  high: { shadowColor: SHADOW, shadowOpacity: 0.26, shadowRadius: 22, shadowOffset: { width: 0, height: 12 }, elevation: 12 },
} as const satisfies Record<string, ViewStyle>;
