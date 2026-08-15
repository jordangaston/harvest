// A dev-only in-memory feed of the most recent analytics events, powering the on-screen debug
// overlay. Pure (no React Native / Expo imports) so the core stays unit-testable under node.
export type DebugEvent = { event: string; props: Record<string, unknown> };

type Listener = (events: DebugEvent[]) => void;

const buffer: DebugEvent[] = [];
let listener: Listener | null = null;

/** Appends an event to the feed (newest first, capped) and notifies the overlay if mounted. */
export function pushDebugEvent(event: string, props: Record<string, unknown>): void {
  buffer.unshift({ event, props });
  if (buffer.length > 6) buffer.pop();
  listener?.([...buffer]);
}

/** Subscribes the overlay to the feed; returns an unsubscribe. */
export function subscribeDebugEvents(l: Listener): () => void {
  listener = l;
  l([...buffer]);
  return () => {
    if (listener === l) listener = null;
  };
}
