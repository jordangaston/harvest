import React from "react";
import { Animated, AccessibilityInfo, View } from "react-native";
import { Text, Icon } from "../ui";
import { TOAST, EASE } from "../../lib/motion";
import { ELEVATION } from "../../lib/elevation";

type ToastVariant = "success" | "error";

/**
 * A brief semantic toast. **Success** drops in from the **top** (green, ✓);
 * **error** rises from the **bottom** (red, !) — position + colour + icon all carry
 * the meaning, not colour alone. Honors Reduce Motion (no travel when enabled).
 * Colour is set inline (NativeWind's colour class doesn't resolve in an `Animated.View`).
 * `top`/`bottom` override the variant's default placement.
 */
export function Toast({ message, variant = "success", top, bottom }: { message: string; variant?: ToastVariant; top?: number; bottom?: number }) {
  const anim = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (reduce) anim.setValue(1);
      else Animated.timing(anim, { toValue: 1, duration: TOAST.inMs, easing: EASE.smoothOut, useNativeDriver: false }).start();
    });
  }, [anim, message]);

  const isSuccess = variant === "success";
  const placeTop = top ?? (isSuccess && bottom == null ? 64 : undefined);
  const placeBottom = bottom ?? (!isSuccess && top == null ? 96 : undefined);
  const enterFrom = placeTop != null ? -TOAST.rise : TOAST.rise; // top drops down, bottom rises up
  const bg = isSuccess ? "#4E7A3F" : "#B23A2E"; // success / error

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: 20,
        right: 20,
        top: placeTop,
        bottom: placeBottom,
        opacity: anim,
        transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [enterFrom, 0] }) }],
      }}
    >
      <View className="flex-row items-center justify-center rounded-2xl px-4 py-3" style={[{ backgroundColor: bg, gap: 8 }, ELEVATION.medium]}>
        <Icon name={isSuccess ? "checkmark-circle" : "alert-circle"} size={18} color="#FBF6EC" />
        <Text style={{ color: "#FBF6EC" }} className="text-center font-semibold">{message}</Text>
      </View>
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
