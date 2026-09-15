/** Symmetric eigendecomposition via cyclic Jacobi rotations — enough to factor the (small, symmetric)
 * PPMI matrix without a math dependency. For a symmetric matrix, SVD reduces to this: singular values
 * are |eigenvalues|, and the embedding is the top-k eigenvectors scaled by √|eigenvalue|. */

export interface Eigenpair {
  value: number;
  /** Unit eigenvector, length n. */
  vector: number[];
}

/**
 * Eigen-decompose a symmetric `n×n` matrix `A` (given as row arrays) with cyclic Jacobi rotations.
 * Returns all n eigenpairs (unsorted). `A` is not mutated. Converges quadratically for symmetric
 * input; `maxSweeps`/`tol` bound the work (the PPMI matrix is a few hundred dims, so this is cheap).
 */
export function jacobiEigen(A: number[][], maxSweeps = 100, tol = 1e-10): Eigenpair[] {
  const n = A.length;
  const a = A.map((row) => [...row]);
  const V = identity(n);

  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    if (offNorm(a) < tol) break;
    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(a[p]![q]!) < tol) continue;
        rotate(a, V, p, q);
      }
    }
  }

  const pairs: Eigenpair[] = [];
  for (let i = 0; i < n; i++) pairs.push({ value: a[i]![i]!, vector: V.map((row) => row[i]!) });
  return pairs;
}

/** The top-`k` eigenpairs by |eigenvalue| (PPMI isn't PSD, so rank by magnitude), value desc. */
export function topEigenpairs(A: number[][], k: number): Eigenpair[] {
  return jacobiEigen(A)
    .sort((x, y) => Math.abs(y.value) - Math.abs(x.value))
    .slice(0, k);
}

/** One Jacobi rotation zeroing a[p][q]=a[q][p], applied to `a` and accumulated into `V`. */
function rotate(a: number[][], V: number[][], p: number, q: number): void {
  const n = a.length;
  const app = a[p]![p]!;
  const aqq = a[q]![q]!;
  const apq = a[p]![q]!;
  const phi = (aqq - app) / (2 * apq);
  // t = tan(θ): the smaller root, guarding phi = 0.
  const t = Math.sign(phi || 1) / (Math.abs(phi) + Math.sqrt(phi * phi + 1));
  const c = 1 / Math.sqrt(t * t + 1);
  const s = t * c;

  for (let i = 0; i < n; i++) {
    const aip = a[i]![p]!;
    const aiq = a[i]![q]!;
    a[i]![p] = c * aip - s * aiq;
    a[i]![q] = s * aip + c * aiq;
  }
  for (let i = 0; i < n; i++) {
    const api = a[p]![i]!;
    const aqi = a[q]![i]!;
    a[p]![i] = c * api - s * aqi;
    a[q]![i] = s * api + c * aqi;
  }
  for (let i = 0; i < n; i++) {
    const vip = V[i]![p]!;
    const viq = V[i]![q]!;
    V[i]![p] = c * vip - s * viq;
    V[i]![q] = s * vip + c * viq;
  }
}

/** Frobenius norm of the strictly-upper off-diagonal — the convergence measure. */
function offNorm(a: number[][]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) sum += a[i]![j]! * a[i]![j]!;
  return Math.sqrt(sum);
}

function identity(n: number): number[][] {
  return Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
}
