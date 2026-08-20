import { Analytics } from "./core";
import { getMixpanelToken } from "./config";
import { createMixpanelBackend } from "./mixpanelBackend";

/** The app-wide analytics singleton. Import and call `analytics.track(...)` anywhere. */
export const analytics = new Analytics({ debug: false });

/**
 * Wires the live Mixpanel backend when a token is configured; otherwise the singleton stays on the
 * Noop backend and sends nothing (decision #5). Idempotent; call once at app start.
 */
export function initAnalytics(): void {
  const token = getMixpanelToken();
  if (token) analytics.setBackend(createMixpanelBackend(token));
}
