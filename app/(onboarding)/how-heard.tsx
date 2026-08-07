import React from "react";
import { View, Image, ImageSourcePropType } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { OnboardingScreen } from "../../components/recime/OnboardingScreen";
import { VStack, HStack, Text, Heading, Pressable } from "../../components/ui";
import { setHowHeard } from "../../lib/onboarding";

type Source = {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  color?: string;
  image?: ImageSourcePropType; // painterly icon for non-brand rows
};

const SOURCES: Source[] = [
  { label: "TikTok", icon: "musical-notes" },
  { label: "Google Search", icon: "logo-google" },
  { label: "YouTube", icon: "logo-youtube", color: "#FF0000" },
  { label: "Instagram", icon: "logo-instagram", color: "#E4405F" },
  { label: "Pinterest", icon: "logo-pinterest", color: "#E60023" },
  { label: "Email Newsletter", icon: "mail", image: require("../../assets/hh-email.png") },
  { label: "Search on App Store", icon: "search", image: require("../../assets/hh-appstore.png") },
  { label: "Facebook", icon: "logo-facebook", color: "#1877F2" },
  { label: "Through a friend", icon: "people", image: require("../../assets/hh-friend.png") },
  { label: "Other", icon: "ellipsis-horizontal", image: require("../../assets/hh-other.png") },
];

export default function HowHeard() {
  const router = useRouter();
  const [selected, setSelected] = React.useState<string | null>(null);

  return (
    <OnboardingScreen
      progress={0.45}
      ctaLabel="Continue"
      ctaDisabled={!selected}
      onCta={() => {
        if (selected) setHowHeard(selected);
        router.push("/(onboarding)/recipe-sources");
      }}
    >
      <VStack space={4}>
        <Heading>How did you hear about us?</Heading>

        <VStack className="mt-4">
          {SOURCES.map((s) => {
            const isSelected = selected === s.label;
            return (
              <Pressable
                key={s.label}
                onPress={() => setSelected(s.label)}
                className={`mb-3 flex-row items-center rounded-2xl border bg-card px-4 py-4 ${
                  isSelected ? "border-brand" : "border-hairline"
                }`}
              >
                <HStack className="flex-1 items-center" space={12}>
                  <View className="w-9 items-center">
                    {s.image ? (
                      <Image source={s.image} resizeMode="contain" style={{ width: 36, height: 36 }} />
                    ) : (
                      <Ionicons name={s.icon} size={22} color={s.color ?? "#2E2419"} />
                    )}
                  </View>
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
