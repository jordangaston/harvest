import React from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { OnboardingScreen } from "../../components/recime/OnboardingScreen";
import { VStack, Text, Heading, Pressable } from "../../components/ui";

const OPTIONS = ["24 and under", "25-34", "35-44", "45-54", "55+"];

export default function Age() {
  const router = useRouter();
  const [selected, setSelected] = React.useState<string | null>(null);

  return (
    <OnboardingScreen
      progress={0.78}
      ctaLabel="Continue"
      ctaDisabled={selected === null}
      onCta={() => router.push("/(onboarding)/referral")}
    >
      <View>
        <Heading className="text-2xl">How old are you?</Heading>
        <Text className="mt-2 text-muted">
          We only use this information to personalize your experience
        </Text>
      </View>

      <VStack className="mt-6" space={12}>
        {OPTIONS.map((option) => {
          const isSelected = selected === option;
          return (
            <Pressable
              key={option}
              onPress={() => setSelected(option)}
              className={`items-center rounded-2xl border bg-card px-4 py-4 ${
                isSelected ? "border-brand" : "border-hairline"
              }`}
            >
              <Text className="text-base text-ink">{option}</Text>
            </Pressable>
          );
        })}
      </VStack>
    </OnboardingScreen>
  );
}
