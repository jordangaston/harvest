import { TasteSpace } from './taste-space.js';
import { AnchorResolver } from './anchor-resolver.js';
import { TasteRepository } from './taste-repository.js';

/**
 * Sources a swipe deck by affinity (P2): resolves the user's anchors, then walks the taste space
 * from them to order the candidate set. Returns `null` when the user has no anchors, so the caller
 * falls back to the non-affinity deck. The seven scorers rerank whatever this selects.
 */
export class DeckSourcer {
  constructor(
    private readonly space: TasteSpace,
    private readonly anchors: AnchorResolver,
  ) {}

  static create(space: TasteSpace, repo: TasteRepository): DeckSourcer {
    return new DeckSourcer(space, AnchorResolver.create(space, repo));
  }

  /** Order `candidateIds` by affinity (top neighbourhood + exploration slice), or `null` if no anchors. */
  async source(userId: string, candidateIds: string[], k: number): Promise<string[] | null> {
    const set = await this.anchors.anchors(userId);
    return this.space.source(set, candidateIds, k);
  }
}
