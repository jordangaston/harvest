import { topEigenpairs } from './svd.js';

/** The co-occurrence embedding model: PPMI over token co-occurrence → SVD → token vectors → SIF
 * pooling → per-recipe vectors. Tokens are a recipe's base ingredients plus folded-in pseudo-tokens
 * (cuisine, dish form). Pure over in-memory bags; the build script is a thin db adapter. */

export interface EmbeddingOptions {
  /** Prune tokens appearing in fewer than this many recipes (the unreliable tail). */
  minDf: number;
  /** SVD dimensions (top-k eigenpairs by |eigenvalue|). */
  dims: number;
  /** SIF smoothing constant a in weight = a/(a + p(token)). */
  sifA: number;
}

export const DEFAULT_OPTIONS: EmbeddingOptions = { minDf: 20, dims: 100, sifA: 1e-3 };

export interface Ppmi {
  tokens: string[];
  index: Map<string, number>;
  /** Symmetric positive-PMI matrix over the pruned tokens. */
  matrix: number[][];
  /** Per-token recipe count (document frequency), aligned to `tokens`. */
  counts: number[];
  n: number;
}

/** Build the symmetric PPMI matrix from recipe token-bags, pruning tokens below `minDf`. */
export function buildPpmi(bags: string[][], minDf: number): Ppmi {
  const n = bags.length;
  const df = new Map<string, number>();
  for (const bag of bags) for (const t of new Set(bag)) df.set(t, (df.get(t) ?? 0) + 1);
  const tokens = [...df.keys()].filter((t) => df.get(t)! >= minDf).sort();
  const index = new Map(tokens.map((t, i) => [t, i]));
  const counts = tokens.map((t) => df.get(t)!);
  const m = tokens.length;

  const co = Array.from({ length: m }, () => new Array(m).fill(0));
  for (const bag of bags) {
    const ids = [...new Set(bag)].filter((t) => index.has(t)).map((t) => index.get(t)!);
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        co[ids[i]!]![ids[j]!]++;
        co[ids[j]!]![ids[i]!]++;
      }
    }
  }

  const matrix = Array.from({ length: m }, () => new Array<number>(m).fill(0));
  for (let i = 0; i < m; i++) {
    for (let j = i + 1; j < m; j++) {
      const cab = co[i]![j]!;
      if (cab === 0) continue;
      const ppmi = Math.max(0, Math.log((cab * n) / (counts[i]! * counts[j]!)));
      matrix[i]![j] = ppmi;
      matrix[j]![i] = ppmi;
    }
  }
  return { tokens, index, matrix, counts, n };
}

/** Token vectors = top-k eigenvectors scaled by √|eigenvalue| (rows aligned to `ppmi.tokens`). */
export function tokenVectors(ppmi: Ppmi, dims: number): number[][] {
  const pairs = topEigenpairs(ppmi.matrix, dims);
  const scale = pairs.map((p) => Math.sqrt(Math.abs(p.value)));
  return ppmi.tokens.map((_t, i) => pairs.map((p, k) => p.vector[i]! * scale[k]!));
}

/** SIF-pooled, common-component-removed, L2-normalized recipe vectors. */
export function poolRecipes(
  bags: Map<string, string[]>,
  ppmi: Ppmi,
  vecs: number[][],
  sifA: number,
): Map<string, number[]> {
  const dims = vecs[0]?.length ?? 0;
  const weightOf = (i: number) => sifA / (sifA + ppmi.counts[i]! / ppmi.n);

  const ids: string[] = [];
  const raw: number[][] = [];
  for (const [id, bag] of bags) {
    const v = new Array(dims).fill(0);
    let wsum = 0;
    for (const t of new Set(bag)) {
      const i = ppmi.index.get(t);
      if (i === undefined) continue;
      const w = weightOf(i);
      wsum += w;
      for (let d = 0; d < dims; d++) v[d] += w * vecs[i]![d]!;
    }
    if (wsum === 0) continue; // no pruned-vocab tokens → unrepresentable, skip
    for (let d = 0; d < dims; d++) v[d] /= wsum;
    ids.push(id);
    raw.push(v);
  }

  // SIF common-component removal: subtract the projection onto the first principal component.
  const pc = firstPrincipalComponent(raw, dims);
  const out = new Map<string, number[]>();
  for (let r = 0; r < raw.length; r++) {
    const v = raw[r]!;
    if (pc) {
      const proj = dot(v, pc);
      for (let d = 0; d < dims; d++) v[d] -= proj * pc[d]!;
    }
    out.set(ids[r]!, l2normalize(v));
  }
  return out;
}

/** First principal component of the row vectors, via the top eigenvector of XᵀX (d×d). */
function firstPrincipalComponent(rows: number[][], dims: number): number[] | null {
  if (rows.length === 0 || dims === 0) return null;
  const cov = Array.from({ length: dims }, () => new Array<number>(dims).fill(0));
  for (const v of rows) {
    for (let i = 0; i < dims; i++) for (let j = i; j < dims; j++) cov[i]![j]! += v[i]! * v[j]!;
  }
  for (let i = 0; i < dims; i++) for (let j = i + 1; j < dims; j++) cov[j]![i] = cov[i]![j]!;
  const [top] = topEigenpairs(cov, 1);
  return top ? top.vector : null;
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

function l2normalize(v: number[]): number[] {
  const norm = Math.sqrt(dot(v, v));
  return norm === 0 ? v : v.map((x) => x / norm);
}

/** Recipe vectors in a shared embedding space; cosine = dot (vectors are L2-normalized). */
export class EmbeddingSpace {
  constructor(private readonly vectors: Map<string, number[]>) {}

  static build(bags: Map<string, string[]>, opts: EmbeddingOptions = DEFAULT_OPTIONS): EmbeddingSpace {
    const ppmi = buildPpmi([...bags.values()], opts.minDf);
    const vecs = tokenVectors(ppmi, opts.dims);
    return new EmbeddingSpace(poolRecipes(bags, ppmi, vecs, opts.sifA));
  }

  get size(): number {
    return this.vectors.size;
  }

  vector(recipeId: string): number[] | undefined {
    return this.vectors.get(recipeId);
  }

  /** Cosine similarity (0 when either recipe is unrepresented). */
  similarity(a: string, b: string): number {
    const va = this.vectors.get(a);
    const vb = this.vectors.get(b);
    return va && vb ? dot(va, vb) : 0;
  }
}
