import React from "react";
import { useRouter } from "expo-router";
import { OnboardingScreen } from "../../components/recime/OnboardingScreen";
import { ImportDemoCard } from "../../components/recime/ImportDemoCard";
import { VStack, Text, Heading } from "../../components/ui";

export default function WebsiteImport() {
  const router = useRouter();
  const goNext = React.useCallback(
    () => router.push("/(onboarding)/recipe-imported?id=banana-walnut-bread"),
    [router]
  );
  const skip = React.useCallback(() => router.push("/(onboarding)/age"), [router]);

  return (
    <OnboardingScreen progress={0.7} onSkip={skip}>
      <VStack space={16}>
        <Heading className="text-center text-2xl">Import from websites</Heading>

        <ImportDemoCard
          variant="web"
          image={require("../../assets/recipe-banana-bread.jpg")}
          onDone={goNext}
        />

        <Text className="text-center text-sm text-muted">
          On any recipe site, tap share and send the page to Harvest.
        </Text>
      </VStack>
    </OnboardingScreen>
  );
}
