import React from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { OnboardingScreen } from "../../components/recime/OnboardingScreen";
import { VStack, Center, Text, Heading, Image } from "../../components/ui";

export default function GoalsHappen() {
  const router = useRouter();
  return (
    <OnboardingScreen
      progress={0.25}
      ctaLabel="Continue"
      onCta={() => router.push("/(onboarding)/when-cook")}
    >
      <VStack space={12}>
        <View>
          <Heading className="text-2xl">Let's make your goals happen!</Heading>
          <Text className="mt-2 text-base text-muted">
            You want to eat healthier and plan out meals — we'll help you get
            there.
          </Text>
        </View>

        <Center className="mt-6">
          <Image
            source={require("../../assets/goals-happen.png")}
            resizeMode="contain"
            className="h-72 w-72"
          />
        </Center>
      </VStack>
    </OnboardingScreen>
  );
}
