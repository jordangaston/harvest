import React from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { OnboardingScreen } from "../../components/recime/OnboardingScreen";
import { VStack, Text, Heading, Input } from "../../components/ui";
import { setName } from "../../lib/onboarding";

export default function Name() {
  const router = useRouter();
  const [name, setNameState] = React.useState("");
  const trimmed = name.trim();

  const submit = () => {
    if (!trimmed) return;
    setName(trimmed);
    router.push("/(onboarding)/phone");
  };

  return (
    <OnboardingScreen progress={0.82} ctaLabel="Continue" ctaDisabled={!trimmed} onCta={submit}>
      <View>
        <Heading className="text-2xl">What's your name?</Heading>
        <Text className="mt-2 text-muted">So Harvest can greet you the right way.</Text>
      </View>

      <VStack className="mt-6" space={12}>
        <Input
          value={name}
          onChangeText={setNameState}
          placeholder="Your name"
          autoFocus
          autoCapitalize="words"
          autoComplete="name"
          returnKeyType="next"
          onSubmitEditing={submit}
        />
      </VStack>
    </OnboardingScreen>
  );
}
