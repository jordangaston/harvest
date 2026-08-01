import React from "react";
import { useRouter } from "expo-router";
import { OnboardingScreen } from "../../components/recime/OnboardingScreen";
import { OptionRow } from "../../components/recime/OptionRow";
import { VStack, Center, Text, Heading } from "../../components/ui";

const GOALS = [
  { emoji: "🥗", label: "Eat healthier" },
  { emoji: "💰", label: "Save money" },
  { emoji: "🔪", label: "Improve cooking skills" },
  { emoji: "📁", label: "Organize recipes" },
  { emoji: "📅", label: "Plan out meals" },
  { emoji: "🌮", label: "Try new cuisines" },
];

export default function Goals() {
  const router = useRouter();
  const [selected, setSelected] = React.useState<string[]>([]);

  const toggle = (label: string) =>
    setSelected((prev) =>
      prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label]
    );

  return (
    <OnboardingScreen
      progress={0.15}
      ctaLabel="Continue"
      ctaDisabled={selected.length === 0}
      onCta={() => router.push("/(onboarding)/thats-great")}
    >
      <VStack space={8}>
        <Center>
          <Heading className="text-2xl">What are your goals?</Heading>
          <Text className="mt-1 text-base text-muted">Select all that apply</Text>
        </Center>

        <VStack className="mt-4">
          {GOALS.map((g) => (
            <OptionRow
              key={g.label}
              label={g.label}
              emoji={g.emoji}
              variant="check"
              selected={selected.includes(g.label)}
              onPress={() => toggle(g.label)}
            />
          ))}
        </VStack>
      </VStack>
    </OnboardingScreen>
  );
}
