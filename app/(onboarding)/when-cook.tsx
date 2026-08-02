import React from "react";
import { useRouter } from "expo-router";
import { OnboardingScreen } from "../../components/recime/OnboardingScreen";
import { OptionRow } from "../../components/recime/OptionRow";
import { VStack, Text, Heading } from "../../components/ui";

const OPTIONS = [
  { label: "In the morning, I like to plan ahead", image: require("../../assets/when-morning.png") },
  { label: "Around lunch time, when I start thinking about it", image: require("../../assets/when-lunch.png") },
  { label: "In the evening, when I'm ready to cook", image: require("../../assets/when-evening.png") },
  { label: "Once a week, I like a fixed schedule", image: require("../../assets/when-weekly.png") },
  { label: "I meal prep", image: require("../../assets/when-prep.png") },
];

// The last three answers earn a follow-up: evening asks a cook time,
// the schedule/meal-prep answers ask when they meal plan (day + time).
const TIME_FOLLOWUP = "In the evening, when I'm ready to cook";
const DAY_FOLLOWUP = ["Once a week, I like a fixed schedule", "I meal prep"];

export default function WhenCook() {
  const router = useRouter();
  const [selected, setSelected] = React.useState<string | null>(null);

  const onContinue = () => {
    if (selected === TIME_FOLLOWUP) {
      router.push("/(onboarding)/cook-time?mode=time");
    } else if (selected && DAY_FOLLOWUP.includes(selected)) {
      router.push("/(onboarding)/cook-time?mode=day");
    } else {
      router.push("/(onboarding)/notifications");
    }
  };

  return (
    <OnboardingScreen
      progress={0.3}
      ctaLabel="Continue"
      ctaDisabled={selected === null}
      onCta={onContinue}
    >
      <VStack space={8}>
        <Heading className="text-2xl">
          When do you usually think about what to cook?
        </Heading>
        <Text className="text-base text-muted">
          We'll check in at the right moment, not a random one.
        </Text>

        <VStack className="mt-4">
          {OPTIONS.map((o) => (
            <OptionRow
              key={o.label}
              label={o.label}
              image={o.image}
              variant="pill"
              selected={selected === o.label}
              onPress={() => setSelected(o.label)}
            />
          ))}
        </VStack>
      </VStack>
    </OnboardingScreen>
  );
}
