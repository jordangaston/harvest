import { Stack } from "expo-router";

// Onboarding flow — a plain stack; each screen owns its cream chrome.
export default function OnboardingLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: "#F1E6D2" },
        animation: "slide_from_right",
      }}
    >
      {/* Phone is the flow's final step, not a new place — swap it in instantly like the
          in-flow steps do (those are internal state, so they never slide). */}
      <Stack.Screen name="phone" options={{ animation: "none" }} />
    </Stack>
  );
}
