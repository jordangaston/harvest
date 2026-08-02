import React from "react";
import { useRouter, useLocalSearchParams } from "expo-router";
import { OnboardingScreen } from "../../components/recime/OnboardingScreen";
import { OptionRow } from "../../components/recime/OptionRow";
import { VStack, HStack, Text, Heading, Pressable } from "../../components/ui";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const TIMES = ["Before 5 PM", "5 – 6 PM", "6 – 7 PM", "7 – 8 PM", "After 8 PM"];

export default function CookTime() {
  const router = useRouter();
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const askDay = mode === "day";

  const [days, setDays] = React.useState<string[]>([]);
  const [time, setTime] = React.useState<string | null>(null);

  const toggleDay = (d: string) =>
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));

  const canContinue = time !== null && (!askDay || days.length > 0);

  return (
    <OnboardingScreen
      progress={0.33}
      ctaLabel="Continue"
      ctaDisabled={!canContinue}
      onCta={() =>
        router.push(`/(onboarding)/notifications?context=${askDay ? "plan" : "cook"}`)
      }
    >
      <VStack space={8}>
        <Heading className="text-2xl">
          {askDay ? "When do you usually meal plan?" : "What time do you usually start cooking?"}
        </Heading>
        <Text className="text-base text-muted">
          {askDay
            ? "We'll nudge you so you're ready to shop and prep."
            : "We'll remind you a little before, so nothing feels rushed."}
        </Text>

        {askDay ? (
          <VStack className="mt-4" space={12}>
            <Text className="text-base font-semibold text-ink">Which days?</Text>
            <HStack className="flex-wrap" space={8}>
              {DAYS.map((d) => {
                const on = days.includes(d);
                return (
                  <Pressable
                    key={d}
                    onPress={() => toggleDay(d)}
                    className={`rounded-full border px-4 py-2 ${
                      on ? "border-brand bg-brand-light" : "border-hairline bg-card"
                    }`}
                  >
                    <Text className={`text-ink ${on ? "font-semibold" : ""}`}>{d}</Text>
                  </Pressable>
                );
              })}
            </HStack>
          </VStack>
        ) : null}

        <VStack className="mt-4">
          {TIMES.map((t) => (
            <OptionRow
              key={t}
              label={t}
              variant="pill"
              selected={time === t}
              onPress={() => setTime(t)}
            />
          ))}
        </VStack>
      </VStack>
    </OnboardingScreen>
  );
}
