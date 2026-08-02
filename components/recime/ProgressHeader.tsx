import React from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { HStack, Pressable, Text } from "../ui";
import { Ionicons } from "@expo/vector-icons";

/** Onboarding top bar: back chevron, thin progress track, optional Skip link. */
export function ProgressHeader({
  progress = 0.3,
  onSkip,
  showBack = true,
}: {
  progress?: number;
  onSkip?: () => void;
  showBack?: boolean;
}) {
  const router = useRouter();
  // router.back() throws "GO_BACK was not handled" when there's no history
  // (e.g. a screen reached without a stack); fall back to the flow start.
  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/(onboarding)/welcome");
  };
  return (
    <HStack className="items-center px-4 pt-2" space={12}>
      {showBack ? (
        <Pressable onPress={goBack} className="p-1">
          <Ionicons name="chevron-back" size={24} color="#2E2419" />
        </Pressable>
      ) : (
        <View className="w-6" />
      )}
      <View className="h-1.5 flex-1 overflow-hidden rounded-full bg-black/10">
        <View
          className="h-full rounded-full bg-brand"
          style={{ width: `${Math.min(100, Math.max(0, progress * 100))}%` }}
        />
      </View>
      {onSkip ? (
        <Pressable onPress={onSkip} className="p-1">
          <Text className="text-ink font-medium">Skip</Text>
        </Pressable>
      ) : (
        <View className="w-6" />
      )}
    </HStack>
  );
}
