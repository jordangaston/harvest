import React from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { OnboardingScreen } from "../../components/recime/OnboardingScreen";
import { VStack, Text, Heading, Input } from "../../components/ui";

export default function Referral() {
  const router = useRouter();
  const [code, setCode] = React.useState("");

  return (
    <OnboardingScreen
      progress={0.82}
      ctaLabel="Continue"
      onCta={() => router.push("/(onboarding)/setting-up")}
    >
      <View>
        <Heading className="text-2xl">Enter referral code (optional)</Heading>
        <Text className="mt-2 text-muted">You can skip this step</Text>
      </View>

      <VStack className="mt-6" space={12}>
        <Input
          placeholder="Referral code"
          value={code}
          onChangeText={setCode}
          autoCapitalize="characters"
        />
      </VStack>
    </OnboardingScreen>
  );
}
