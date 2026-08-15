import Constants from "expo-constants";

/**
 * The Mixpanel project token from app config `extra.mixpanelToken`, or undefined when unset.
 * Unset is the default in dev / sim / tests, which keeps analytics on the Noop backend (decision #5).
 * See DESIGN.md Appendix B for how the founder configures the prod token.
 */
export function getMixpanelToken(): string | undefined {
  const token = (Constants.expoConfig?.extra as { mixpanelToken?: unknown } | undefined)?.mixpanelToken;
  return typeof token === "string" && token.length > 0 ? token : undefined;
}
