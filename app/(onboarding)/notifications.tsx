import React from "react";
import { View } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import * as ExpoNotifications from "expo-notifications";
import { OnboardingScreen } from "../../components/recime/OnboardingScreen";
import { VStack, Text, Heading, Center, Pressable } from "../../components/ui";

export default function Notifications() {
  const router = useRouter();
  const { context } = useLocalSearchParams<{ context?: string }>();
  const isPlan = context === "plan";

  const heading = isPlan
    ? "Get recipe ideas before you shop"
    : "Get the right recipe at the right time";
  const body = isPlan
    ? "We'll recommend recipes before you shop, so you're ready to prep."
    : "We'll send you a recipe idea at the time that works for you.";
  const ctaLabel = isPlan ? "Remind me before I shop" : "Help me stay on track";

  const next = () => router.push("/(onboarding)/how-heard");

  // Always fire the real iOS notification permission prompt, then continue.
  // requestPermissionsAsync is idempotent: it shows the OS dialog when the
  // status is undetermined and otherwise resolves silently.
  const requestAndNext = async () => {
    try {
      await ExpoNotifications.requestPermissionsAsync({
        ios: { allowAlert: true, allowBadge: true, allowSound: true },
      });
    } catch {
      // permissions unavailable (e.g. simulator quirks) — continue anyway
    }
    next();
  };

  return (
    <OnboardingScreen
      progress={0.35}
      ctaLabel={ctaLabel}
      onCta={requestAndNext}
    >
      <VStack space={8}>
        <Heading className="text-center">{heading}</Heading>
        <Text className="text-center text-muted">{body}</Text>

        <Center className="mt-10">
          {/* Mimics the real iOS system permission dialog — intentionally white. */}
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
              <Pressable className="flex-1 items-center justify-center py-3" onPress={next}>
                <Text className="text-base text-brand">Don't Allow</Text>
              </Pressable>
              <View className="w-px bg-hairline" />
              <Pressable
                className="flex-1 items-center justify-center py-3"
                onPress={requestAndNext}
              >
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
