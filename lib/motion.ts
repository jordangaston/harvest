import { Easing } from "react-native";

/**
 * Motion tokens — the React Native adaptation of the transitions.dev scale.
 * Reference these instead of hardcoding durations/easing so timing stays
 * consistent, and follow the one rule that carries the most weight: an opening
 * is an invitation (slower), a close gets out of the way (quicker). Durations
 * are milliseconds; `smoothOut` is the shared cubic-bezier(0.22, 1, 0.36, 1).
 */
export const DURATION = {
  quick: 150, // quick close / dismiss
  fast: 250, // close of a surface, icon/page swap
  medium: 350, // surface open (toast, sheet), panel close
  slow: 400, // large panel open
} as const;

/** Surface open/close, slide, resize all share the smooth-out curve. */
export const EASE = {
  smoothOut: Easing.bezier(0.22, 1, 0.36, 1),
  inOut: Easing.inOut(Easing.ease),
} as const;

export const DISTANCE = {
  base: 8, // page slide
  toast: 16, // toast rise from below
} as const;

/** Toast: rises from below with a fade, slower in than out (open > close). */
export const TOAST = { inMs: DURATION.medium, outMs: DURATION.fast, rise: DISTANCE.toast } as const;
