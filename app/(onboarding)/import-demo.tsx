import React from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { OnboardingScreen } from "../../components/recime/OnboardingScreen";
import { VStack, HStack, Text, Heading, Center } from "../../components/ui";

export default function ImportDemo() {
  const router = useRouter();
  const next = () => router.push("/(onboarding)/recipe-imported");

  return (
    <OnboardingScreen
      progress={0.6}
      onSkip={next}
      ctaLabel="Continue"
      onCta={next}
    >
      <VStack space={12}>
        <Heading className="text-center">Smart social media imports</Heading>

        <HStack className="items-center justify-center" space={16}>
          <Ionicons name="logo-instagram" size={28} color="#E4405F" />
          <Ionicons name="logo-facebook" size={28} color="#1877F2" />
          <Ionicons name="logo-tiktok" size={28} color="#2E2419" />
          <Ionicons name="logo-youtube" size={28} color="#FF0000" />
          <View className="h-7 w-7 items-center justify-center rounded-full bg-[#E60023]">
            <Text className="text-sm font-bold text-white">P</Text>
          </View>
        </HStack>

        <View className="mt-6 rounded-2xl bg-gray-100 p-4">
          <HStack className="items-center" space={12}>
            <View className="h-10 w-10 rounded-lg bg-gray-300" />
            <VStack className="flex-1" space={6}>
              <View className="h-2.5 w-3/4 rounded-full bg-gray-300" />
              <View className="h-2.5 w-1/2 rounded-full bg-gray-300" />
            </VStack>
          </HStack>

          <HStack className="mt-5 items-end justify-between">
            <Center className="w-14">
              <View className="h-12 w-12 items-center justify-center rounded-xl bg-gray-300">
                <Ionicons name="wifi" size={22} color="#6E5B48" />
              </View>
              <Text className="mt-1 text-[10px] text-muted">Airdrop</Text>
            </Center>

            <Center className="w-14">
              <View className="h-12 w-12 items-center justify-center rounded-xl bg-brand">
                <Ionicons name="restaurant" size={22} color="#fff" />
              </View>
              <Text className="mt-1 text-[10px] text-muted">Harvest</Text>
            </Center>

            <Center className="w-14">
              <View className="h-12 w-12 items-center justify-center rounded-xl bg-gray-300">
                <Ionicons name="chatbubble" size={22} color="#6E5B48" />
              </View>
              <Text className="mt-1 text-[10px] text-muted">Messages</Text>
            </Center>

            <Center className="w-14">
              <View className="h-12 w-12 items-center justify-center rounded-xl bg-gray-300">
                <Ionicons name="mail" size={22} color="#6E5B48" />
              </View>
              <Text className="mt-1 text-[10px] text-muted">Mail</Text>
            </Center>
          </HStack>

          <Center className="mt-3">
            <View className="flex-row items-center rounded-full bg-brand px-4 py-2">
              <Ionicons name="hand-left" size={16} color="#fff" />
              <Text className="ml-2 text-base font-bold text-white">Tap here</Text>
            </View>
          </Center>

          <View className="mt-4 rounded-xl bg-white">
            <HStack className="items-center justify-between px-4 py-3">
              <Text className="text-base text-ink">Copy</Text>
              <Ionicons name="copy-outline" size={20} color="#2E2419" />
            </HStack>
            <View className="h-px w-full bg-hairline" />
            <HStack className="items-center justify-between px-4 py-3">
              <Text className="text-base text-ink">Add to reading list</Text>
              <Ionicons name="glasses-outline" size={20} color="#2E2419" />
            </HStack>
          </View>
        </View>
      </VStack>
    </OnboardingScreen>
  );
}
