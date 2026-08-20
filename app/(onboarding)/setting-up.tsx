import React from "react";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { OnboardingScreen } from "../../components/recime/OnboardingScreen";
import { CookingLoaderText } from "../../components/recime/CookingLoaderText";
import { VStack, Heading, Text, Center } from "../../components/ui";
import { createAnonymousUser, flushOnboarding } from "../../lib/api/auth";

export default function SettingUp() {
  const router = useRouter();
  const [failed, setFailed] = React.useState(false);

  // Finalize onboarding: create the anonymous account (persists goals + cook-days),
  // then flush the preference draft. Idempotent on retry — the stored device key
  // resolves the same account, so a re-run only re-attempts the failed step.
  const finish = React.useCallback(async () => {
    setFailed(false);
    try {
      await createAnonymousUser();
      await flushOnboarding();
      router.replace("/(app)/discover");
    } catch {
      setFailed(true);
    }
  }, [router]);

  React.useEffect(() => {
    finish();
  }, [finish]);

  if (failed) {
    return (
      <OnboardingScreen progress={1} showBack={false} ctaLabel="Try again" onCta={finish}>
        <VStack className="mt-12 items-center" space={16}>
          <Heading className="text-center text-2xl">We hit a snag setting things up</Heading>
          <Text className="text-center text-muted">Check your connection and try again.</Text>
        </VStack>
      </OnboardingScreen>
    );
  }

  return (
    <OnboardingScreen progress={1} showBack={false}>
      <VStack className="mt-12 items-center" space={32}>
        <Heading className="text-center text-2xl">We're setting everything up for you</Heading>

        <Center>
          <Image
            source={require("../../assets/loader.webp")}
            contentFit="contain"
            style={{ width: 219, height: 335 }}
          />
        </Center>

        <CookingLoaderText size={24} />
      </VStack>
    </OnboardingScreen>
  );
}
