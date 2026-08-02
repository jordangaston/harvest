import React from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { OnboardingScreen } from "../../components/recime/OnboardingScreen";
import { Box, VStack, HStack, Text, Heading, Center } from "../../components/ui";

export default function WebsiteImport() {
  const router = useRouter();
  const goNext = () => router.push("/(onboarding)/age");

  return (
    <OnboardingScreen
      progress={0.7}
      onSkip={goNext}
      ctaLabel="Continue"
      onCta={goNext}
    >
      <VStack space={4}>
        <View className="items-center">
          <Heading className="text-2xl">Import from websites</Heading>
        </View>

        <Box className="mt-4 overflow-hidden rounded-2xl border border-hairline bg-card">
          <View className="p-5">
            <HStack className="items-center justify-between pb-3">
              <Ionicons name="menu" size={18} color="#6E5B48" />
              <Center className="h-7 w-7 rounded-full bg-orange-600">
                <Text className="text-[8px] font-bold text-white">nom</Text>
              </Center>
              <HStack space={12}>
                <Ionicons name="search" size={16} color="#6E5B48" />
                <Ionicons name="bookmark-outline" size={16} color="#6E5B48" />
                <Ionicons name="cart-outline" size={16} color="#6E5B48" />
              </HStack>
            </HStack>

            <Heading className="text-xl">Banana Walnut Bread</Heading>

            <HStack className="mt-3 items-center" space={6}>
              <HStack space={2}>
                {[0, 1, 2, 3, 4].map((i) => (
                  <Ionicons key={i} name="star" size={14} color="#F59E0B" />
                ))}
              </HStack>
              <Text className="text-sm text-muted">1093 Reviews</Text>
            </HStack>

            <View className="mt-4 h-2.5 w-full rounded-full bg-gray-200" />
            <View className="mt-2 h-2.5 w-4/5 rounded-full bg-gray-200" />
          </View>

          <View className="relative">
            <Center className="h-24 w-full bg-cream">
              <Text className="text-3xl">🍞</Text>
            </Center>

            <View className="absolute -top-6 right-6 items-center">
              <View className="rounded-full bg-brand px-4 py-2">
                <Text className="text-base font-bold text-white">Tap here</Text>
              </View>
              <Text className="mt-1 text-lg">👇</Text>
            </View>

            <Center className="absolute bottom-3 right-4 h-10 w-10 rounded-full border border-hairline bg-card">
              <Ionicons name="share-outline" size={18} color="#A85E2B" />
            </Center>
          </View>
        </Box>
      </VStack>
    </OnboardingScreen>
  );
}
