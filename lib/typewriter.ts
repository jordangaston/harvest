/**
 * Pure reveal math for the onboarding Typewriter — kept framework-free so it's
 * node-testable (see design/typewriter.test.ts). The component drives elapsed
 * time; this decides how many characters are visible.
 *
 * Reduce Motion (or a non-positive speed) reveals the whole string at once — the
 * one hard rule the AGENTS.md motion section demands.
 */
export function revealCount(
  elapsedMs: number,
  msPerChar: number,
  total: number,
  reduceMotion: boolean,
): number {
  if (reduceMotion || msPerChar <= 0) return total;
  if (elapsedMs <= 0) return 0;
  return Math.max(0, Math.min(total, Math.floor(elapsedMs / msPerChar)));
}
