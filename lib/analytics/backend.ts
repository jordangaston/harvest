/** Event/property payload sent to the analytics sink. */
export type Props = Record<string, unknown>;

/**
 * The analytics sink. `NoopBackend` discards everything (dev / sim / tests, and any build with no
 * Mixpanel token); `createMixpanelBackend` forwards to the real SDK. The core is written against this
 * interface so no call site needs to know which backend is active.
 */
export interface Backend {
  track(event: string, props?: Props): void;
  identify(userId: string): void;
  setPeople(props: Props): void;
  reset(): void;
}

/** Sends nothing. The default backend until a token wires the real one (decision #5). */
export const NoopBackend: Backend = {
  track() {},
  identify() {},
  setPeople() {},
  reset() {},
};
