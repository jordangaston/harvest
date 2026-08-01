import React from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { OnboardingScreen } from "../../components/recime/OnboardingScreen";
import { VStack, Center, Text, Heading } from "../../components/ui";

export default function ThatsGreat() {
  const router = useRouter();
  return (
    <OnboardingScreen
      progress={0.2}
      ctaLabel="Continue"
      onCta={() => router.push("/(onboarding)/goals-happen")}
    >
      <VStack space={12}>
        <Center>
          <Heading className="text-2xl">That's great!</Heading>
          <Text className="mt-2 text-center text-base text-muted">
            92% of users report that Harvest has seamlessly helped them to eat
            healthier and plan out meals
          </Text>
        </Center>

        <Center className="mt-4 h-56 rounded-3xl bg-gray-200">
          <Text className="text-6xl">👩‍🍳</Text>
        </Center>

        <Center className="mt-4">
          <Text className="text-center text-lg font-bold text-ink">
            We're here to help you with your goals 🤝
          </Text>
        </Center>
      </VStack>
    </OnboardingScreen>
  );
}
