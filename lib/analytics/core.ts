import { NoopBackend, type Backend, type Props } from "./backend.ts";
import { toPeopleProperties, type OnboardingPayload } from "./people.ts";

export type AnalyticsOptions = {
  /** When true, log each event to the console — wired to `__DEV__` so the sim shows the stream. */
  debug?: boolean;
  /** Injectable clock for `signup_at`; tests pass a fixed value. */
  now?: () => string;
};

/**
 * The backend-agnostic analytics core. It has no React Native / Expo imports, so it is unit-testable
 * under plain node. It stays on `NoopBackend` until `setBackend` wires a real one, and every public
 * method swallows backend errors — a failed analytics call must never break a user action.
 */
export class Analytics {
  private backend: Backend = NoopBackend;
  private screen: string | undefined;
  private debug: boolean;
  private now: () => string;

  constructor(opts: AnalyticsOptions = {}) {
    this.debug = opts.debug ?? false;
    this.now = opts.now ?? (() => new Date().toISOString());
  }

  /** Binds the live backend (only when a token exists); otherwise the core stays Noop. */
  setBackend(backend: Backend): void {
    this.backend = backend;
  }

  /** Records the current route so every later event carries `screen`; dedupes an unchanged path. */
  setScreen(screen: string): void {
    if (screen === this.screen) return;
    this.screen = screen;
    this.track("Screen Viewed", { screen });
  }

  track(event: string, props: Props = {}): void {
    const merged = this.screen ? { screen: this.screen, ...props } : props;
    if (this.debug) console.log(`📊 ${event}`, merged);
    try {
      this.backend.track(event, merged);
    } catch {
      // analytics must never break the app
    }
  }

  /**
   * Real signup only — the caller guards on a present onboarding payload so anonymous re-provision
   * (first launch, 401 refresh fallback) never fires this. Identifies the user, sets people-properties,
   * and tracks the signup, in that order.
   */
  onSignup(userId: string, onboarding: OnboardingPayload): void {
    try {
      this.backend.identify(userId);
      this.backend.setPeople(toPeopleProperties(onboarding, this.now()));
    } catch {
      // ignore
    }
    this.track("Signup Completed");
  }

  reset(): void {
    this.screen = undefined;
    try {
      this.backend.reset();
    } catch {
      // ignore
    }
  }
}
