import React from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { OnboardingScreen } from "../../components/recime/OnboardingScreen";
import { VStack, Text, Heading, Center } from "../../components/ui";

export default function BetterCook() {
  const router = useRouter();
  return (
    <OnboardingScreen
      progress={0.92}
      ctaLabel="Continue"
      ctaAction="brand"
      onCta={() => router.push("/(onboarding)/paywall-intro")}
    >
      <VStack space={16}>
        <Center>
          <Heading className="text-center text-3xl leading-9">
            Become a better cook,{"\n"}with Harvest
          </Heading>
        </Center>

        <View className="mt-4 rounded-2xl px-2 py-6">
          <View className="h-56 w-full">
            {[0, 1, 2, 3, 4].map((i) => (
              <View
                key={i}
                className="absolute left-0 right-0 h-px bg-hairline"
                style={{ top: i * 44 + 8 }}
              />
            ))}

            <View className="absolute bottom-2 left-[14%] top-2 w-px bg-hairline" />
            <View className="absolute bottom-2 right-[14%] top-2 w-px bg-hairline" />

            {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
              const t = i / 7;
              const left = 14 + t * 72;
              const bottom = 6 + Math.pow(t, 2.4) * 80;
              const color = t < 0.5 ? "#E8843C" : "#A85E2B";
              return (
                <View
                  key={`d-${i}`}
                  className="absolute h-1.5 w-1.5 rounded-full"
                  style={{
                    left: `${left}%`,
                    bottom: `${bottom}%`,
                    backgroundColor: color,
                  }}
                />
              );
            })}

            <View
              className="absolute h-3.5 w-3.5 rounded-full border-2 border-white"
              style={{ left: "13%", bottom: "6%", backgroundColor: "#E8843C" }}
            />
            <View
              className="absolute rounded-md bg-[#E8843C] px-2 py-1"
              style={{ left: "10%", bottom: "22%" }}
            >
              <Text className="text-[11px] font-semibold text-white">Scattered recipes</Text>
            </View>

            <View
              className="absolute h-3.5 w-3.5 rounded-full border-2 border-white"
              style={{ right: "13%", bottom: "86%", backgroundColor: "#A85E2B" }}
            />
            <View
              className="absolute rounded-md bg-brand px-2 py-1"
              style={{ right: "8%", bottom: "94%" }}
            >
              <Text className="text-[11px] font-semibold text-white">Organized recipes</Text>
            </View>
          </View>

          <View className="mt-2 flex-row justify-between px-[10%]">
            <Text className="text-[11px] font-semibold text-[#E8843C]">Now</Text>
            <Text className="text-[11px] font-semibold text-brand">Your goal</Text>
          </View>
        </View>

        <Center className="mt-6">
          <Text className="text-center text-muted">
            You're on your way! Watch as your cooking habits evolve and your kitchen experience gets easier.
          </Text>
        </Center>
      </VStack>
    </OnboardingScreen>
  );
}
