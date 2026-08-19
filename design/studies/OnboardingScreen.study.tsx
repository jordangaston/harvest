import React from "react";
import { OnboardingScreen } from "../../components/recime/OnboardingScreen";
import { Text } from "../../components/ui";
import type { Study } from "../types.ts";

function OnboardingScreenStudyView() {
  return (
    <OnboardingScreen
      progress={0.4}
      ctaLabel="Continue"
      onCta={() => {}}
      onSkip={() => {}}
    >
      <Text className="text-2xl font-bold text-ink">Welcome to Harvest</Text>
      <Text className="mt-2 text-base text-muted">
        The onboarding shell: cream canvas, logo, progress header, scrollable body, and a pinned CTA.
      </Text>
    </OnboardingScreen>
  );
}

export const OnboardingScreenStudy: Study = {
  name: "OnboardingScreen",
  group: "Onboarding",
  render: () => <OnboardingScreenStudyView />,
};
