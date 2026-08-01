import React from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { OnboardingScreen } from "../../components/recime/OnboardingScreen";
import { VStack, HStack, Text, Heading, Icon, Center } from "../../components/ui";

export default function Testimonials() {
  const router = useRouter();
  return (
    <OnboardingScreen
      progress={0.1}
      ctaLabel="Continue"
      onCta={() => router.push("/(onboarding)/goals")}
    >
      <VStack space={8}>
        <Center>
          <Heading className="text-2xl">We've helped</Heading>
          <Heading className="mt-1 text-3xl text-brand">10+ million cooks</Heading>
          <Text className="mt-2 text-center text-base text-ink">
            be more organized and save time in the kitchen
          </Text>
        </Center>

        <View className="mt-6 rounded-2xl border border-hairline bg-white p-5">
          <HStack space={4} className="items-center">
            {[0, 1, 2, 3, 4].map((i) => (
              <Icon key={i} name="star" size={20} color="#A85E2B" />
            ))}
          </HStack>

          <Text className="mt-2 text-5xl font-bold text-ink">“</Text>

          <Text className="-mt-4 text-base font-bold text-ink">
            Life-changing for my recipe collection!
          </Text>

          <Text className="mt-3 text-base leading-6 text-ink">
            “I used to screenshot recipes from Instagram and Pinterest, and they
            were always lost in my camera roll. Now, with Harvest, I can import
            them directly and keep everything organized in one place”
          </Text>

          <View className="my-4 h-px bg-hairline" />

          <HStack space={8} className="items-center">
            <View className="h-8 w-8 rounded-full bg-gray-300" />
            <Text className="text-base text-ink">Leslie A.</Text>
          </HStack>
        </View>
      </VStack>
    </OnboardingScreen>
  );
}
