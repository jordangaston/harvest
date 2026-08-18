import { describe, it, expect } from 'vitest';
import { TechniqueMatcher } from '../src/difficulty/technique-matcher.js';
import { DifficultyScorer } from '../src/difficulty/difficulty-scorer.js';
import { DIFFICULTY_CONFIG, TECHNIQUE_DIFFICULTY } from '../src/difficulty/technique-difficulty.js';

/**
 * WI-DIFF-2 — the pure scoring engine. Constants are kept REAL (no mocked caps/lexicon):
 * these tests pin the acceptance criteria against the shipped table and config.
 */

describe('TECHNIQUE_DIFFICULTY (AC-1: table shape)', () => {
  it('every entry is well-formed: canonical string, 1..5 weight, non-empty lowercase forms', () => {
    expect(TECHNIQUE_DIFFICULTY.length).toBeGreaterThanOrEqual(40);
    expect(TECHNIQUE_DIFFICULTY.length).toBeLessThanOrEqual(60);
    const weights = new Set<number>();
    for (const entry of TECHNIQUE_DIFFICULTY) {
      expect(typeof entry.canonical).toBe('string');
      expect(entry.canonical.length).toBeGreaterThan(0);
      expect(Number.isInteger(entry.weight)).toBe(true);
      expect(entry.weight).toBeGreaterThanOrEqual(1);
      expect(entry.weight).toBeLessThanOrEqual(5);
      expect(entry.forms.length).toBeGreaterThan(0);
      for (const form of entry.forms) expect(form).toBe(form.toLowerCase());
      weights.add(entry.weight);
    }
    // Spans the full 1–5 scale.
    expect([...weights].sort()).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('TechniqueMatcher.stepWeights (O-DIFF-01)', () => {
  const matcher = TechniqueMatcher.create();

  it('AC-2: hardest technique in a step wins (temper=5, bain-marie=5, stir=1 → 5)', () => {
    expect(matcher.stepWeights(['Temper the chocolate over a bain-marie, stirring.'])).toEqual([5]);
  });

  it('AC-3: no recognized technique → baseline 1', () => {
    expect(matcher.stepWeights(['Season and serve.'])).toEqual([1]);
  });

  it('AC-4: word boundaries — "search"/"scallion" do not fire sear/scald', () => {
    expect(matcher.stepWeights(['Search the pantry and add a scallion.'])).toEqual([1]);
  });

  it('AC-5: multi-word + hyphen/space normalization — sous-vide == sous vide', () => {
    const [hyphen] = matcher.stepWeights(['Cook sous-vide']);
    const [space] = matcher.stepWeights(['Cook sous vide']);
    expect(hyphen).toBe(space);
    expect(hyphen).toBe(5);
  });

  it('AC-6: index alignment — N steps in, N weights out, aligned', () => {
    const steps = ['Chop the onion.', 'Temper the chocolate.', 'Serve.'];
    const weights = matcher.stepWeights(steps);
    expect(weights).toHaveLength(steps.length);
    expect(weights).toEqual([2, 5, 1]);
  });

  it('multi-word "water bath" phrase matches as a bain-marie (5)', () => {
    expect(matcher.stepWeights(['Melt over a water bath.'])).toEqual([5]);
  });
});

describe('DifficultyScorer.score (O-DIFF-02)', () => {
  const scorer = DifficultyScorer.create();

  it('AC-7: T = peak/5 and stepDifficulties is the per-step vector [5,2,1]', () => {
    // Steps engineered to yield per-step weights [5,2,1].
    const result = scorer.score(['Temper the chocolate.', 'Chop the nuts.', 'Serve.'], 0, null);
    expect(result.stepDifficulties).toEqual([5, 2, 1]);
    // T = 5/5 = 1.0 dominates a 3-term mean with S,N tiny → verified via the blend below.
  });

  it('AC-8: worked blend ≈ 55.6 for T=1.0, steps=6, ings=9, minutes=45', () => {
    // Six steps whose max weight is 5 (temper) → T = 1.0.
    const steps = ['Temper the chocolate.', 'Chop.', 'Mix.', 'Stir.', 'Serve.', 'Warm.'];
    const result = scorer.score(steps, 9, 45);
    expect(result.score).toBeCloseTo(55.6, 1);
    expect(result.band).toBe('intermediate');
  });

  it('AC-9: null minutes drops M — mean over three terms, not zero-filled', () => {
    const steps = ['Temper the chocolate.', 'Chop.', 'Mix.', 'Stir.', 'Serve.', 'Warm.'];
    const withNull = scorer.score(steps, 9, null);
    // mean(1.0, 6/15, 9/20) = (1.0+0.4+0.45)/3 = 0.6167 → 61.7
    expect(withNull.score).toBeCloseTo(61.7, 1);
  });

  it('AC-11: empty recipe → raw 0, beginner, no step difficulties', () => {
    const result = scorer.score([], 0, null);
    expect(result.score).toBe(0);
    expect(result.band).toBe('beginner');
    expect(result.stepDifficulties).toEqual([]);
  });

  it('AC-12: deterministic — same inputs, identical output', () => {
    const steps = ['Temper.', 'Chop.'];
    expect(scorer.score(steps, 5, 30)).toEqual(scorer.score(steps, 5, 30));
  });
});

describe('DifficultyScorer bands at cutoffs (O-DIFF-03, AC-10)', () => {
  const scorer = DifficultyScorer.create();
  const { C50, C85, TIME_CAP } = DIFFICULTY_CONFIG;

  // Drive the raw score to land ON a target with minutes as the fine lever, over the
  // 4-factor mean: raw = 100 × (T + S + N + minutes/TIME_CAP) / 4. One step (S=1/15) and
  // ING_CAP ingredients (N=1.0) are fixed; the step's technique fixes T. C50=38 is only
  // reachable with a trivial step (T=0.2, low floor); C85=66 with a temper step (T=1.0).
  const S = 1 / DIFFICULTY_CONFIG.STEP_CAP;
  const N = 1.0;
  const minutesFor = (raw: number, T: number) => ((raw * 4) / 100 - (T + S + N)) * TIME_CAP;
  const trivialBand = (raw: number) =>
    scorer.score(['Stir.'], DIFFICULTY_CONFIG.ING_CAP, minutesFor(raw, 0.2)).band;
  const hardBand = (raw: number) =>
    scorer.score(['Temper the chocolate.'], DIFFICULTY_CONFIG.ING_CAP, minutesFor(raw, 1.0)).band;

  it('raw == C50 → intermediate (inclusive lower)', () => {
    expect(trivialBand(C50)).toBe('intermediate');
  });

  it('raw just below C50 → beginner', () => {
    expect(trivialBand(C50 - 0.5)).toBe('beginner');
  });

  it('raw == C85 → advanced (inclusive lower)', () => {
    expect(hardBand(C85)).toBe('advanced');
  });

  it('raw just below C85 → intermediate', () => {
    expect(hardBand(C85 - 0.5)).toBe('intermediate');
  });
});

describe('DifficultyScorer headline behaviors (from the design)', () => {
  const scorer = DifficultyScorer.create();

  it('(a) one temper step amid trivial steps → T peaks at 1.0 (peak, not mean)', () => {
    const steps = ['Chop the nuts.', 'Temper the chocolate.', 'Toss.', 'Serve.'];
    const result = scorer.score(steps, 5, 20);
    // Peak-driven: max weight 5 → T = 1.0. If T were a mean it would be far lower.
    expect(Math.max(...result.stepDifficulties)).toBe(5);
    // T alone contributes 100/nFactors; with modest S,N,M this lands high.
    expect(result.band).not.toBe('beginner');
  });

  it('(b) 22 trivial steps → high S lifts it to intermediate, not beginner', () => {
    const steps = Array.from({ length: 22 }, (_, i) => (i % 2 ? 'Chop the vegetables.' : 'Toss and bake.'));
    const result = scorer.score(steps, 12, 40);
    // T is low (trivial techniques), but S saturates (22 > STEP_CAP=15 → S=1.0).
    expect(result.band).toBe('intermediate');
    expect(Math.max(...result.stepDifficulties)).toBeLessThanOrEqual(2);
  });
});
