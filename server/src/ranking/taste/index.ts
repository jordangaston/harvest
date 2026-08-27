import { TasteSpace } from './taste-space.js';
import { DeckSourcer } from './deck-sourcer.js';
import { TasteRepository } from './taste-repository.js';

export { TasteSpace } from './taste-space.js';
export { DeckSourcer } from './deck-sourcer.js';
export { AnchorResolver } from './anchor-resolver.js';
export { FacetTasteProfileService } from './facet-taste-profile-service.js';
export { TasteRepository } from './taste-repository.js';
export type { TasteProfile } from './taste-profile.js';
export type { Anchor, AnchorSet } from './taste-space.js';

let cachedSpace: TasteSpace | null = null;

/**
 * A DeckSourcer for this request. The taste space (every recipe profile) is loaded once and cached
 * in module scope across warm invocations (D-06) — the data is request-independent; only the
 * per-user anchor reads use the request's repo. A native vector index is the upgrade path when the
 * corpus outgrows memory.
 *
 * CONTRACT: the cache is not auto-invalidated. After `build:taste` rebuilds the profiles, a running
 * process serves the old space until it restarts or calls {@link resetTasteSpace}. Fine for
 * short-lived serverless instances (they cold-start fresh); a long-lived server must restart on rebuild.
 */
export async function tasteDeckSourcer(repo: TasteRepository): Promise<DeckSourcer> {
  if (!cachedSpace) cachedSpace = new TasteSpace(await repo.allProfiles());
  return DeckSourcer.create(cachedSpace, repo);
}

/** Drop the cached space so the next {@link tasteDeckSourcer} reloads it (after a rebuild, or per test). */
export function resetTasteSpace(): void {
  cachedSpace = null;
}
