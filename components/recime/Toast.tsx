import React from "react";
import { Animated, AccessibilityInfo } from "react-native";
import { Box, Text } from "../ui";
import { TOAST, EASE } from "../../lib/motion";

/** A brief bottom toast — rises slower than it drops (motion tokens); honors Reduce
 * Motion (no travel/fade when enabled). Colour is set inline because NativeWind's
 * colour class doesn't resolve inside an `Animated.View`. */
export function Toast({ message, bottom = 96 }: { message: string; bottom?: number }) {
  const anim = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (reduce) anim.setValue(1);
      else Animated.timing(anim, { toValue: 1, duration: TOAST.inMs, easing: EASE.smoothOut, useNativeDriver: false }).start();
    });
  }, [anim, message]);
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: 20,
        right: 20,
        bottom,
        opacity: anim,
        transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [TOAST.rise, 0] }) }],
      }}
    >
      <Box className="rounded-2xl bg-ink px-4 py-3">
        <Text style={{ color: "#FBF6EC" }} className="text-center font-semibold">{message}</Text>
      </Box>
    </Animated.View>
  );
}

/** Returns a `showToast(message)` that displays it briefly then clears it. */
export function useToast(setToast: (m: string | null) => void, ms = 2200) {
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return React.useCallback(
    (message: string) => {
      setToast(message);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setToast(null), ms);
    },
    [setToast, ms],
  );
}
