import React from "react";
import { View, Image } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { OnboardingScreen } from "../../components/recime/OnboardingScreen";
import { VStack, Text, Heading, Center } from "../../components/ui";

export default function Awesome() {
  const router = useRouter();

  return (
    <OnboardingScreen
      progress={0.55}
      ctaLabel="Show me how"
      onCta={() => router.push("/(onboarding)/import-demo")}
    >
      <VStack space={12}>
        <Heading>Awesome 🎉</Heading>
        <Text className="text-muted">
          Harvest can import recipes from Instagram, TikTok, Facebook, Pinterest, YouTube, and websites.
        </Text>

        <Center className="mt-6">
          <View className="h-72 w-72">
            <Image
              source={require("../../assets/awesome-book.png")}
              resizeMode="contain"
              style={{ width: "100%", height: "100%" }}
            />

            <View className="absolute -left-4 top-24 h-12 w-12 items-center justify-center rounded-2xl bg-black">
              <Ionicons name="logo-tiktok" size={26} color="#fff" />
            </View>
            <View className="absolute -right-4 bottom-16 h-12 w-12 items-center justify-center rounded-2xl bg-card shadow">
              <Ionicons name="logo-instagram" size={26} color="#E4405F" />
            </View>
            <View className="absolute -right-2 top-16 h-12 w-12 items-center justify-center rounded-2xl bg-[#1877F2]">
              <Ionicons name="logo-facebook" size={26} color="#fff" />
            </View>
            <View className="absolute -left-2 -top-4 h-12 w-12 items-center justify-center rounded-2xl bg-[#E60023]">
              <Ionicons name="logo-pinterest" size={26} color="#fff" />
            </View>
          </View>
        </Center>
      </VStack>
    </OnboardingScreen>
  );
}
