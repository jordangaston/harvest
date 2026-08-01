import React from "react";
import { useRouter } from "expo-router";
import { OnboardingScreen } from "../../components/recime/OnboardingScreen";
import { VStack, Center, Text, Heading } from "../../components/ui";

export default function GoalsHappen() {
  const router = useRouter();
  return (
    <OnboardingScreen
      progress={0.25}
      ctaLabel="Continue"
      onCta={() => router.push("/(onboarding)/when-cook")}
    >
      <VStack space={12}>
        <Center>
          <Heading className="text-center text-2xl">
            Let's make your goals happen!
          </Heading>
          <Text className="mt-2 text-center text-base text-muted">
            You want to eat healthier and plan out meals — we'll help you get
            there.
          </Text>
        </Center>

        <Center className="mt-8">
          <Text style={{ fontSize: 120 }}>🥗</Text>
        </Center>
      </VStack>
    </OnboardingScreen>
  );
}
