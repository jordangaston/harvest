import React from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { OnboardingScreen } from "../../components/recime/OnboardingScreen";
import { VStack, Text, Heading, Center, Spinner } from "../../components/ui";

const CAPTIONS = [
  "Downloading Harvest's import tool...",
  "Preparing features just for you...",
];

function BlobLogo() {
  return (
    <View className="h-52 w-52">
      <View className="absolute left-[64px] top-[8px] h-24 w-24 rounded-[40px_48px_36px_52px] bg-green-500" />
      <View className="absolute left-[128px] top-[24px] h-6 w-6 rounded-md bg-plus" />
      <View className="absolute left-[36px] top-[72px] h-28 w-24 rounded-[52px_44px_48px_40px] bg-yellow-400" />
      <View className="absolute left-[120px] top-[68px] h-24 w-28 rounded-[44px_52px_40px_48px] bg-orange-400" />
      <View className="absolute left-[92px] top-[128px] h-16 w-24 rounded-[40px_48px_36px_52px] bg-brand" />
    </View>
  );
}

export default function SettingUp() {
  const router = useRouter();
  const [captionIndex, setCaptionIndex] = React.useState(0);

  React.useEffect(() => {
    const interval = setInterval(() => {
      setCaptionIndex((i) => (i + 1) % CAPTIONS.length);
    }, 1200);
    const timeout = setTimeout(() => {
      router.replace("/(app)/recipes");
    }, 2500);
    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [router]);

  return (
    <OnboardingScreen progress={0.88} showBack={false}>
      <VStack className="mt-12 items-center" space={40}>
        <Heading className="text-center text-2xl">We're setting everything up for you</Heading>

        <Center>
          <BlobLogo />
        </Center>

        <VStack className="items-center" space={16}>
          <Spinner />
          <Text className="text-center text-muted">{CAPTIONS[captionIndex]}</Text>
        </VStack>
      </VStack>
    </OnboardingScreen>
  );
}
