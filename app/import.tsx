import React from "react";
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Backdrop } from "../components/recime/Backdrop";
import { VStack, HStack, Text, Heading, Pressable, Icon } from "../components/ui";

type Src = { source: string; icon: React.ComponentProps<typeof Ionicons>["name"]; color: string; bg: string };

const SOURCES: Src[] = [
  { source: "Instagram", icon: "logo-instagram", color: "#E4405F", bg: "#FCEBF0" },
  { source: "TikTok", icon: "musical-notes", color: "#2E2419", bg: "#EFE7D9" },
  { source: "Facebook", icon: "logo-facebook", color: "#1877F2", bg: "#E7F0FE" },
];

export default function ImportRecipe() {
  const router = useRouter();

  return (
    <SafeAreaView className="flex-1 bg-cream" edges={["top", "bottom"]}>
      <Backdrop />

      <HStack className="items-center justify-between px-5 pt-2">
        <Pressable onPress={() => router.back()} className="p-1">
          <Icon name="close" size={26} color="#2E2419" />
        </Pressable>
        <View className="w-8" />
      </HStack>

      <VStack className="px-6 pt-2" space={8}>
        <Heading className="text-2xl">Add a recipe</Heading>
        <Text className="text-base text-muted">
          Import from wherever you find recipes — we'll pull in the ingredients and steps for you.
        </Text>

        <VStack className="mt-6" space={12}>
          <Text className="text-sm font-semibold text-muted">Import from social media</Text>
          {SOURCES.map((s) => (
            <Pressable
              key={s.source}
              onPress={() => router.push(`/import-source?source=${s.source}`)}
              className="flex-row items-center rounded-2xl border border-hairline bg-card px-4 py-4"
            >
              <View
                className="h-11 w-11 items-center justify-center rounded-xl"
                style={{ backgroundColor: s.bg }}
              >
                <Ionicons name={s.icon} size={24} color={s.color} />
              </View>
              <Text className="ml-3 flex-1 text-base font-semibold text-ink">{s.source}</Text>
              <Icon name="chevron-forward" size={20} color="#9C8460" />
            </Pressable>
          ))}

          <Pressable
            onPress={() => router.push(`/import-source?source=a website`)}
            className="mt-2 flex-row items-center rounded-2xl border border-hairline bg-card px-4 py-4"
          >
            <View className="h-11 w-11 items-center justify-center rounded-xl bg-sand">
              <Icon name="link" size={22} color="#2E2419" />
            </View>
            <Text className="ml-3 flex-1 text-base font-semibold text-ink">Paste a recipe link</Text>
            <Icon name="chevron-forward" size={20} color="#9C8460" />
          </Pressable>
        </VStack>
      </VStack>
    </SafeAreaView>
  );
}
