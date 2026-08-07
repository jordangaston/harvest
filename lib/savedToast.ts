// A one-shot hand-off for the "Saved to <cookbook>" toast: the save flow (on a
// stack screen) stashes the cookbook name here, then navigates home; the Recipes
// tab reads-and-clears it on focus. Simpler and more reliable than threading a
// route param across the stack→tab boundary (params don't always reach an
// already-mounted tab, and clearing one races the toast's dismiss timer).
let pending: string | null = null;

/** Stash the cookbook name to confirm on the next Recipes focus. */
export function setSavedToast(cookbookName: string): void {
  pending = cookbookName;
}

/** Read and clear the pending confirmation (null if none) — read-once, so it
 * shows exactly once and never re-fires on a later focus. */
export function takeSavedToast(): string | null {
  const value = pending;
  pending = null;
  return value;
}
