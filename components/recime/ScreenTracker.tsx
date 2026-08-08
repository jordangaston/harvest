import { useEffect } from "react";
import { usePathname } from "expo-router";
import { analytics } from "../../lib/analytics";

/**
 * Emits `Screen Viewed` on every route change and records the current route so other events inherit
 * `screen`. Renders nothing. Mount inside the router tree (a child of the root navigator). Repeats of
 * the same path are deduped in `analytics.setScreen`.
 */
export function ScreenTracker() {
  const pathname = usePathname();
  useEffect(() => {
    analytics.setScreen(pathname);
  }, [pathname]);
  return null;
}
