import React from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { OnboardingScreen } from "../../components/recime/OnboardingScreen";
import { VStack, HStack, Text, Heading, Center, Icon, Pressable } from "../../components/ui";

function SocialButton({
  icon,
  color,
  label,
  onPress,
}: {
  icon: React.ComponentProps<typeof Icon>["name"];
  color: string;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="h-14 w-full flex-row items-center justify-center rounded-full border border-hairline bg-white"
    >
      <View className="absolute left-6">
        <Icon name={icon} size={22} color={color} />
      </View>
      <Text className="text-base font-semibold text-ink">{label}</Text>
    </Pressable>
  );
}

export default function CreateAccount() {
  const router = useRouter();
  const go = () => router.replace("/(app)/recipes");

  return (
    <OnboardingScreen showHeader={false} showLogo={true}>
      <VStack space={16}>
        <Center className="mt-4">
          <Heading className="text-2xl">Create an account</Heading>
        </Center>

        <VStack className="mt-2" space={12}>
          <SocialButton icon="logo-apple" color="#000000" label="Continue with Apple" onPress={go} />
          <SocialButton icon="logo-google" color="#EA4335" label="Continue with Google" onPress={go} />
          <SocialButton
            icon="ellipsis-horizontal"
            color="#2E2419"
            label="Other options"
            onPress={go}
          />
        </VStack>

        <Center className="mt-2">
          <HStack className="items-center">
            <Text className="text-muted">Already have an account? </Text>
            <Text className="font-semibold text-brand">Log in</Text>
          </HStack>
        </Center>
      </VStack>

      <Center className="mt-24 px-2">
        <Text className="text-center text-[11px] text-muted">
          Your information is 100% secure. We don't sell your personal information. By submitting your email address, you agree to our Terms and Privacy.
        </Text>
      </Center>
    </OnboardingScreen>
  );
}
