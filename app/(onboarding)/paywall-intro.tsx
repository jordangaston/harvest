import React from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { OnboardingScreen } from "../../components/recime/OnboardingScreen";
import { VStack, HStack, Text, Heading, Center } from "../../components/ui";

export default function PaywallIntro() {
  const router = useRouter();
  return (
    <OnboardingScreen
      showHeader={false}
      showLogo={false}
      ctaLabel="Try for $0.00"
      ctaAction="plus"
      onCta={() => router.push("/(onboarding)/paywall-compare")}
    >
      <VStack space={12}>
        <HStack className="items-center" space={6}>
          <Center className="h-7 w-7 rounded-full bg-plus">
            <Text className="text-[13px]">👑</Text>
          </Center>
          <Text className="text-base font-bold text-plus">Harvest Plus</Text>
        </HStack>

        <Center className="mt-4">
          <Text className="text-center text-muted">Harvest is free to use but...</Text>
          <Heading className="mt-1 text-center text-2xl leading-8">
            We'd love you to try{" "}
            <Text className="text-2xl font-bold text-plus">
              the full experience for 7 days for free
            </Text>
            <Text className="text-2xl font-bold text-ink">!</Text>
          </Heading>
        </Center>

        <View className="mt-8 h-80 w-full">
          <View
            className="absolute h-40 w-40 rounded-full bg-[#F59E2A]"
            style={{ left: "-14%", top: 0, borderRadius: 90 }}
          />
          <View
            className="absolute h-52 w-40"
            style={{ left: "26%", top: 40, backgroundColor: "#F2D511", borderRadius: 90 }}
          />
          <View
            className="absolute h-28 w-28 rounded-full bg-brand"
            style={{ right: "2%", top: 30 }}
          />
          <View
            className="absolute h-40 w-40 bg-[#5BB831]"
            style={{ right: "-8%", bottom: 0, borderTopLeftRadius: 90, borderTopRightRadius: 90, borderBottomRightRadius: 90 }}
          />
          <View
            className="absolute h-10 w-24 rounded-full bg-plus"
            style={{ left: "-6%", bottom: 20 }}
          />
        </View>
      </VStack>
    </OnboardingScreen>
  );
}
