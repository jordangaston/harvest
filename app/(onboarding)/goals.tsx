import React from "react";
import { useRouter } from "expo-router";
import { OnboardingScreen } from "../../components/recime/OnboardingScreen";
import { OptionRow } from "../../components/recime/OptionRow";
import { VStack, Center, Text, Heading } from "../../components/ui";
import { setGoals } from "../../lib/onboarding";

const GOALS = [
  { image: require("../../assets/goal-healthier.png"), label: "Eat healthier" },
  { image: require("../../assets/goal-money.png"), label: "Save money" },
  { image: require("../../assets/goal-skills.png"), label: "Improve cooking skills" },
  { image: require("../../assets/goal-organize.png"), label: "Organize recipes" },
  { image: require("../../assets/goal-plan.png"), label: "Plan out meals" },
  { image: require("../../assets/goal-prep.png"), label: "Meal prepping" },
  { image: require("../../assets/goal-cuisines.png"), label: "Try new cuisines" },
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
      onCta={() => {
        setGoals(selected);
        router.push("/(onboarding)/goals-happen");
      }}
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
              image={g.image}
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
