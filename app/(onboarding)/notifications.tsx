import React from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { OnboardingScreen } from "../../components/recime/OnboardingScreen";
import { VStack, Text, Heading, Center, Pressable } from "../../components/ui";

export default function Notifications() {
  const router = useRouter();
  const next = () => router.push("/(onboarding)/how-heard");

  return (
    <OnboardingScreen
      progress={0.35}
      ctaLabel="Help me stay on track"
      onCta={next}
    >
      <VStack space={8}>
        <Heading className="text-center">Get the right recipe at the right time</Heading>
        <Text className="text-center text-muted">
          We'll send you a recipe idea at the time that works for you.
        </Text>

        <Center className="mt-10">
          <View className="w-72 overflow-hidden rounded-2xl bg-white shadow-lg">
            <VStack className="px-5 pt-5 pb-4" space={8}>
              <Text className="text-center text-base font-bold text-ink">
                "Harvest" Would Like to Send You Notifications
              </Text>
              <Text className="text-center text-sm text-muted">
                Notifications may include alerts, sounds and icon badges. These can be configured in Settings.
              </Text>
            </VStack>
            <View className="h-px w-full bg-hairline" />
            <View className="flex-row">
              <Pressable className="flex-1 items-center justify-center py-3">
                <Text className="text-base text-brand">Don't Allow</Text>
              </Pressable>
              <View className="w-px bg-hairline" />
              <Pressable className="flex-1 items-center justify-center py-3">
                <Text className="text-base font-bold text-brand">Allow</Text>
              </Pressable>
            </View>
          </View>

          <Text className="mt-6 text-center text-sm text-muted">
            Turn off notifications anytime
          </Text>
        </Center>
      </VStack>
    </OnboardingScreen>
  );
}
