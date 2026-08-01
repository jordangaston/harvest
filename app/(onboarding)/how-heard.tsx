import React from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { OnboardingScreen } from "../../components/recime/OnboardingScreen";
import { VStack, HStack, Text, Heading, Pressable } from "../../components/ui";

type Source = {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  color?: string;
};

const SOURCES: Source[] = [
  { label: "TikTok", icon: "musical-notes" },
  { label: "Google Search", icon: "logo-google" },
  { label: "YouTube", icon: "logo-youtube", color: "#FF0000" },
  { label: "Instagram", icon: "logo-instagram", color: "#E4405F" },
  { label: "Email Newsletter", icon: "mail" },
  { label: "Search on App Store", icon: "search" },
  { label: "Facebook", icon: "logo-facebook", color: "#1877F2" },
  { label: "Through a friend", icon: "people" },
  { label: "Other", icon: "ellipsis-horizontal" },
];

export default function HowHeard() {
  const router = useRouter();
  const [selected, setSelected] = React.useState<string | null>(null);

  return (
    <OnboardingScreen
      progress={0.45}
      ctaLabel="Continue"
      ctaDisabled={!selected}
      onCta={() => router.push("/(onboarding)/recipe-sources")}
    >
      <VStack space={4}>
        <Heading>How did you hear about us?</Heading>
        <Pressable className="items-end">
          <Text className="text-sm font-semibold text-brand">I have a referral code</Text>
        </Pressable>

        <VStack className="mt-4">
          {SOURCES.map((s) => {
            const isSelected = selected === s.label;
            return (
              <Pressable
                key={s.label}
                onPress={() => setSelected(s.label)}
                className={`mb-3 flex-row items-center rounded-2xl border bg-white px-4 py-4 ${
                  isSelected ? "border-brand" : "border-hairline"
                }`}
              >
                <HStack className="flex-1 items-center" space={12}>
                  <Ionicons name={s.icon} size={20} color={s.color ?? "#2E2419"} />
                  <Text className="flex-1 text-base text-ink">{s.label}</Text>
                  {isSelected ? (
                    <Ionicons name="checkmark-circle" size={22} color="#A85E2B" />
                  ) : null}
                </HStack>
              </Pressable>
            );
          })}
        </VStack>
      </VStack>
    </OnboardingScreen>
  );
}
