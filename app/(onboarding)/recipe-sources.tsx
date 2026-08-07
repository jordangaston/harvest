import React from "react";
import { View, Image } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { OnboardingScreen } from "../../components/recime/OnboardingScreen";
import { VStack, HStack, Text, Heading, Pressable } from "../../components/ui";
import { setRecipeSources } from "../../lib/onboarding";

function SocialCluster() {
  return (
    <HStack className="items-center" space={6}>
      <Ionicons name="logo-instagram" size={20} color="#E4405F" />
      <Ionicons name="logo-facebook" size={20} color="#1877F2" />
      <Ionicons name="logo-tiktok" size={20} color="#2E2419" />
      <Ionicons name="logo-pinterest" size={20} color="#E60023" />
    </HStack>
  );
}

const OPTIONS = [
  { label: "Social media", right: <SocialCluster /> },
  {
    label: "Recipe websites",
    right: (
      <Image
        source={require("../../assets/src-websites.png")}
        resizeMode="contain"
        style={{ width: 40, height: 40 }}
      />
    ),
  },
  {
    label: "Printed/handwritten recipes",
    right: (
      <Image
        source={require("../../assets/src-printed.png")}
        resizeMode="contain"
        style={{ width: 40, height: 40 }}
      />
    ),
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
      onCta={() => {
        setRecipeSources(selected);
        router.push("/(onboarding)/awesome");
      }}
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
                className={`mb-3 flex-row items-center rounded-2xl border bg-card px-4 py-4 ${
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
