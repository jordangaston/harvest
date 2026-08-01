import React from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { OnboardingScreen } from "../../components/recime/OnboardingScreen";
import { VStack, HStack, Text, Heading, Pressable } from "../../components/ui";

function SocialCluster() {
  return (
    <HStack className="items-center" space={6}>
      <Ionicons name="logo-instagram" size={20} color="#E4405F" />
      <Ionicons name="logo-facebook" size={20} color="#1877F2" />
      <Ionicons name="logo-tiktok" size={20} color="#2E2419" />
      <View className="h-5 w-5 items-center justify-center rounded-full bg-[#E60023]">
        <Text className="text-xs font-bold text-white">P</Text>
      </View>
    </HStack>
  );
}

const OPTIONS = [
  { label: "Social media", right: <SocialCluster /> },
  {
    label: "Recipe websites",
    right: (
      <HStack className="items-center" space={6}>
        <Ionicons name="logo-google" size={20} color="#2E2419" />
        <Ionicons name="globe-outline" size={20} color="#2E2419" />
      </HStack>
    ),
  },
  {
    label: "Printed/handwritten recipes",
    right: <Text className="text-lg">📖 ✍️</Text>,
  },
];

export default function RecipeSources() {
  const router = useRouter();
  const [selected, setSelected] = React.useState<string[]>([]);

  const toggle = (label: string) =>
    setSelected((prev) =>
      prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label]
    );

  return (
    <OnboardingScreen
      progress={0.5}
      ctaLabel="Continue"
      onCta={() => router.push("/(onboarding)/awesome")}
    >
      <VStack space={8}>
        <Heading>Where do you get your recipes from?</Heading>
        <Text className="text-muted">Select all that apply</Text>

        <VStack className="mt-4">
          {OPTIONS.map((o) => {
            const isSelected = selected.includes(o.label);
            return (
              <Pressable
                key={o.label}
                onPress={() => toggle(o.label)}
                className={`mb-3 flex-row items-center rounded-2xl border bg-white px-4 py-4 ${
                  isSelected ? "border-brand" : "border-hairline"
                }`}
              >
                <Text className="flex-1 text-base text-ink">{o.label}</Text>
                {o.right}
              </Pressable>
            );
          })}
        </VStack>
      </VStack>
    </OnboardingScreen>
  );
}
