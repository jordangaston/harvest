import { describe, it, expect } from 'vitest';
import { jacobiEigen, topEigenpairs } from '../src/ranking/embedding/svd.js';

/** Jacobi symmetric eigendecomposition — checked against matrices with known eigenpairs. */

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

describe('jacobiEigen', () => {
  it('recovers a diagonal matrix eigenvalues', () => {
    const pairs = jacobiEigen([[3, 0], [0, 5]]).sort((a, b) => a.value - b.value);
    expect(near(pairs[0]!.value, 3)).toBe(true);
    expect(near(pairs[1]!.value, 5)).toBe(true);
  });

  it('recovers [[2,1],[1,2]] → eigenvalues 3 and 1 with the right eigenvectors', () => {
    const pairs = jacobiEigen([[2, 1], [1, 2]]).sort((a, b) => b.value - a.value);
    expect(near(pairs[0]!.value, 3)).toBe(true);
    expect(near(pairs[1]!.value, 1)).toBe(true);
    // λ=3 → (1,1)/√2 ; λ=1 → (1,-1)/√2 (sign-agnostic).
    const v3 = pairs[0]!.vector;
    expect(near(Math.abs(v3[0]!), Math.abs(v3[1]!))).toBe(true);
    const v1 = pairs[1]!.vector;
    expect(near(v1[0]! + v1[1]!, 0)).toBe(true);
  });

  it('reconstructs A from Q Λ Qᵀ (eigenvectors orthonormal)', () => {
    const A = [[4, 1, 0], [1, 3, 1], [0, 1, 2]];
    const pairs = jacobiEigen(A);
    const n = 3;
    // A_recon[i][j] = Σ_k λ_k v_k[i] v_k[j]
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        let recon = 0;
        for (const p of pairs) recon += p.value * p.vector[i]! * p.vector[j]!;
        expect(near(recon, A[i]![j]!, 1e-5)).toBe(true);
      }
    }
  });

  it('topEigenpairs ranks by |eigenvalue| and returns k (handles negative eigenvalues)', () => {
    // Eigenvalues of [[0,2],[2,0]] are +2 and -2; |·| ties, both selected at k=2, |−2| leads at k=1.
    const top1 = topEigenpairs([[0, 2], [2, 0]], 1);
    expect(top1.length).toBe(1);
    expect(near(Math.abs(top1[0]!.value), 2)).toBe(true);
  });
});
