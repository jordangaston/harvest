import React from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { OnboardingScreen } from "../../components/recime/OnboardingScreen";
import { VStack, HStack, Text, Heading, Center } from "../../components/ui";

export default function TrialReminder() {
  const router = useRouter();
  return (
    <OnboardingScreen
      showHeader={false}
      showLogo={false}
      ctaLabel="Start my free week"
      ctaAction="plus"
      onCta={() => router.push("/(onboarding)/trial-choose")}
      footer={
        <Center className="pb-3">
          <Text className="text-[13px] text-muted">Easy to cancel, no penalties or fees</Text>
        </Center>
      }
    >
      <VStack space={12} className="min-h-[560px]">
        <HStack className="items-center justify-center" space={6}>
          <Center className="h-7 w-7 rounded-full bg-plus">
            <Text className="text-[13px]">👑</Text>
          </Center>
          <Text className="text-base font-bold text-plus">Harvest Plus</Text>
        </HStack>

        <Center className="mt-4">
          <Heading className="text-center text-2xl leading-8">
            We'll remind you <Text className="text-2xl font-bold text-plus">2 days</Text>{" "}
            <Text className="text-2xl font-bold text-ink">before your trial ends</Text>
          </Heading>
          <Text className="mt-3 text-center text-muted">You'll get a notification on Aug 6</Text>
        </Center>

        <Center className="flex-1 py-10">
          <Text style={{ fontSize: 140 }}>🔔</Text>
        </Center>
      </VStack>
    </OnboardingScreen>
  );
}
