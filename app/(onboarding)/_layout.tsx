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
    />
  );
}
