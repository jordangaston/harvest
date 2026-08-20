import React from "react";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { OnboardingScreen } from "../../components/recime/OnboardingScreen";
import { CookingLoaderText } from "../../components/recime/CookingLoaderText";
import { VStack, Heading, Center } from "../../components/ui";

export default function SettingUp() {
  const router = useRouter();

  React.useEffect(() => {
    // The account was already created + verified at the code step; this is just
    // the closing loader before the app opens.
    const timeout = setTimeout(() => {
      router.replace("/(app)/discover");
    }, 2500);
    return () => clearTimeout(timeout);
  }, [router]);

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
