import React from "react";
import { View, Image, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Backdrop } from "../components/recime/Backdrop";
import {
  VStack,
  HStack,
  Center,
  Text,
  Heading,
  Pressable,
  Button,
  ButtonText,
  Icon,
} from "../components/ui";

const APP_SCHEMES: Record<string, string> = {
  Instagram: "instagram://",
  TikTok: "snssdk1233://",
  Facebook: "fb://",
};

export default function ImportSource() {
  const router = useRouter();
  const { source = "Instagram" } = useLocalSearchParams<{ source?: string }>();

  const openApp = async () => {
    const scheme = APP_SCHEMES[source];
    try {
      if (scheme && (await Linking.canOpenURL(scheme))) await Linking.openURL(scheme);
    } catch {
      // app not installed / can't open — the user can use the sample instead
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-cream" edges={["top", "bottom"]}>
      <Backdrop />

      <HStack className="items-center px-5 pt-2">
        <Pressable onPress={() => router.back()} className="p-1">
          <Icon name="chevron-back" size={26} color="#2E2419" />
        </Pressable>
      </HStack>

      <VStack className="flex-1 px-6 pt-2" space={6}>
        <Heading className="text-2xl">Import from {source}</Heading>
        <Text className="text-base text-muted">
          Find a recipe post or reel, tap the share icon, and send it to Harvest.
        </Text>

        {/* mock post preview + coach mark */}
        <Center className="mt-2 flex-1">
          <View className="w-64 overflow-hidden rounded-3xl border border-hairline bg-card">
            <Image
              source={require("../assets/recipe-bourguignon.jpg")}
              resizeMode="cover"
              style={{ width: "100%", height: 240 }}
            />
            <HStack className="items-center px-4 py-3" space={18}>
              <Icon name="heart-outline" size={22} color="#2E2419" />
              <Icon name="chatbubble-outline" size={22} color="#2E2419" />
              <View className="h-9 w-9 items-center justify-center rounded-full bg-brand">
                <Icon name="paper-plane-outline" size={18} color="#fff" />
              </View>
              <View className="flex-1" />
              <Icon name="bookmark-outline" size={22} color="#2E2419" />
            </HStack>
          </View>

          <HStack className="mt-3 items-center" space={6}>
            <Icon name="arrow-up" size={18} color="#8A4A1E" />
            <Text className="font-semibold text-brand-dark">tap the share icon, then choose Harvest</Text>
          </HStack>
        </Center>

        <VStack space={12}>
          <Button className="w-full" onPress={openApp}>
            <ButtonText>Open {source} to find a recipe</ButtonText>
          </Button>
          <Pressable
            className="flex-row justify-center"
            onPress={() => router.push("/importing")}
          >
            <Text className="font-semibold text-brand-dark">Try with a sample recipe</Text>
          </Pressable>
        </VStack>
      </VStack>
    </SafeAreaView>
  );
}
