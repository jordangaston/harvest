import React from "react";
import { View } from "react-native";
import { Text } from "../ui";
import { subscribeDebugEvents, type DebugEvent } from "../../lib/analytics/debugLog";

/**
 * A dev-only floating feed of the most recent analytics events, so the otherwise-invisible
 * instrumentation is visible on screen (used for the demo video). `pointerEvents="none"` so it never
 * intercepts a tap; gated by `__DEV__` at the mount site, so it never renders in production.
 */
export function AnalyticsDebugOverlay() {
  const [events, setEvents] = React.useState<DebugEvent[]>([]);
  React.useEffect(() => subscribeDebugEvents(setEvents), []);
  if (!events.length) return null;
  return (
    <View pointerEvents="none" style={{ position: "absolute", left: 12, right: 12, bottom: 44, gap: 4 }}>
      {events.map((e, i) => (
        <View
          key={`${i}-${e.event}`}
          className="rounded-lg px-3 py-2"
          style={{ backgroundColor: "rgba(46,36,25,0.88)", opacity: 1 - i * 0.14 }}
        >
          <Text className="text-white" style={{ fontFamily: "Karla_700Bold", fontSize: 12 }}>
            📊 {e.event}
          </Text>
          {Object.keys(e.props).length ? (
            <Text className="text-white" style={{ fontSize: 10, opacity: 0.8 }} numberOfLines={1}>
              {JSON.stringify(e.props)}
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}
