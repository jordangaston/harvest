import React from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { OnboardingScreen } from "../../components/recime/OnboardingScreen";
import { VStack, HStack, Text, Heading, Center, Icon } from "../../components/ui";

type Row = {
  name: string;
  subtitle?: string;
  free: React.ReactNode;
  plus: React.ReactNode;
};

const check = (color: string) => <Icon name="checkmark" size={18} color={color} />;
const dash = <Text className="text-muted">—</Text>;

export default function PaywallCompare() {
  const router = useRouter();

  const rows: Row[] = [
    {
      name: "Import Recipes",
      subtitle: "from anywhere you find them",
      free: <Text className="text-[13px] text-muted">5 / week</Text>,
      plus: <Text className="text-[13px] text-plus">Unlimited</Text>,
    },
    {
      name: "Browse & Save Recipes",
      subtitle: "from Harvest Discover Feed",
      free: check("#6E5B48"),
      plus: check("#5C6350"),
    },
    { name: "Grocery Lists", free: check("#6E5B48"), plus: check("#5C6350") },
    { name: "Meal Plans", free: dash, plus: check("#5C6350") },
    { name: "Measurement Converter", free: dash, plus: check("#5C6350") },
    { name: "Nutrition Calculator", free: dash, plus: check("#5C6350") },
    { name: "Ask Harvest: AI Assistant", free: dash, plus: check("#5C6350") },
    { name: "Cooking Mode", free: dash, plus: check("#5C6350") },
    { name: "Print & Export PDF", free: dash, plus: check("#5C6350") },
  ];

  return (
    <OnboardingScreen
      showHeader={false}
      showLogo={false}
      ctaLabel="Start my free week"
      ctaAction="plus"
      onCta={() => router.push("/(onboarding)/trial-reminder")}
    >
      <VStack space={12}>
        <HStack className="items-center" space={6}>
          <Center className="h-7 w-7 rounded-full bg-plus">
            <Text className="text-[13px]">👑</Text>
          </Center>
          <Text className="text-base font-bold text-plus">Harvest Plus</Text>
        </HStack>

        <Heading className="text-2xl leading-8">
          Unlock <Text className="text-2xl font-bold text-plus">unlimited imports</Text>{" "}
          <Text className="text-2xl font-bold text-ink">and other premium features</Text>
        </Heading>

        <View className="mt-2">
          <HStack className="items-end pb-2">
            <View className="flex-1" />
            <Center className="w-16">
              <Text className="text-[13px] font-semibold text-muted">Free</Text>
            </Center>
            <Center className="w-16 rounded-t-2xl bg-plus-light py-2">
              <Text className="text-[15px]">👑</Text>
            </Center>
          </HStack>

          {rows.map((row, i) => (
            <HStack key={row.name} className="items-center border-t border-hairline py-3">
              <View className="flex-1 pr-2">
                <Text className="text-[15px] font-semibold text-ink">{row.name}</Text>
                {row.subtitle ? (
                  <Text className="text-[11px] text-muted">{row.subtitle}</Text>
                ) : null}
              </View>
              <Center className="w-16">{row.free}</Center>
              <Center
                className={`w-16 self-stretch bg-plus-light ${i === rows.length - 1 ? "rounded-b-2xl" : ""}`}
              >
                {row.plus}
              </Center>
            </HStack>
          ))}
        </View>
      </VStack>
    </OnboardingScreen>
  );
}
