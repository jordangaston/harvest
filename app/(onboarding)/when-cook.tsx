import React from "react";
import { useRouter } from "expo-router";
import { OnboardingScreen } from "../../components/recime/OnboardingScreen";
import { OptionRow } from "../../components/recime/OptionRow";
import { VStack, Text, Heading } from "../../components/ui";

const OPTIONS = [
  "In the morning, I like to plan ahead",
  "Around lunch time, when I start thinking about it",
  "In the evening, when I'm ready to cook",
];

export default function WhenCook() {
  const router = useRouter();
  const [selected, setSelected] = React.useState<string | null>(null);

  return (
    <OnboardingScreen
      progress={0.3}
      ctaLabel="Continue"
      ctaDisabled={selected === null}
      onCta={() => router.push("/(onboarding)/notifications")}
    >
      <VStack space={8}>
        <Heading className="text-2xl">
          When do you usually think about what to cook?
        </Heading>
        <Text className="text-base text-muted">
          We'll check in at the right moment, not a random one.
        </Text>

        <VStack className="mt-4">
          {OPTIONS.map((label) => (
            <OptionRow
              key={label}
              label={label}
              variant="pill"
              selected={selected === label}
              onPress={() => setSelected(label)}
            />
          ))}
        </VStack>
      </VStack>
    </OnboardingScreen>
  );
}
