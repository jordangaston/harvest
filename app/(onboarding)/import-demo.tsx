import React from "react";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { OnboardingScreen } from "../../components/recime/OnboardingScreen";
import { ImportDemoCard } from "../../components/recime/ImportDemoCard";
import { SAMPLE_RECIPE } from "../../components/recime/recipes";
import { VStack, HStack, Text, Heading } from "../../components/ui";

export default function ImportDemo() {
  const router = useRouter();
  const next = React.useCallback(() => router.push("/(onboarding)/recipe-imported"), [router]);
  const skip = React.useCallback(() => router.push("/(onboarding)/age"), [router]);

  return (
    <OnboardingScreen progress={0.6} onSkip={skip}>
      <VStack space={16}>
        <VStack space={8} className="items-center">
          <Heading className="text-center text-2xl">Smart social media imports</Heading>
          <HStack className="items-center justify-center" space={18}>
            <Ionicons name="logo-instagram" size={26} color="#E4405F" />
            <Ionicons name="logo-facebook" size={26} color="#1877F2" />
            <Ionicons name="logo-tiktok" size={26} color="#2E2419" />
            <Ionicons name="logo-youtube" size={26} color="#FF0000" />
            <Ionicons name="logo-pinterest" size={26} color="#E60023" />
          </HStack>
        </VStack>

        <ImportDemoCard variant="social" image={SAMPLE_RECIPE.image} onDone={next} />

        <Text className="text-center text-sm text-muted">
          Find a recipe, tap share, and send it to Harvest.
        </Text>
      </VStack>
    </OnboardingScreen>
  );
}
