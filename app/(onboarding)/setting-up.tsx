import React from "react";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { OnboardingScreen } from "../../components/recime/OnboardingScreen";
import { CookingLoaderText } from "../../components/recime/CookingLoaderText";
import { VStack, Heading, Center } from "../../components/ui";
import { ensureSession } from "../../lib/api/auth";

export default function SettingUp() {
  const router = useRouter();

  React.useEffect(() => {
    // End of onboarding: provision the account now, so its signup POST carries the
    // collected onboarding payload (C2). The 2.5s loader plays while it runs; a
    // failure doesn't block the app (client.ts re-provisions on the next call).
    ensureSession().catch(() => {});
    const timeout = setTimeout(() => {
      router.replace("/(app)/recipes");
    }, 2500);
    return () => clearTimeout(timeout);
  }, [router]);

  return (
    <OnboardingScreen progress={0.88} showBack={false}>
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
