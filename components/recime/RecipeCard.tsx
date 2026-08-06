import React from "react";
import { View } from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { VStack, Text, Pressable, Icon } from "../ui";

/**
 * A recipe tile: thumbnail (or a token placeholder when there's no image) + name.
 * Tapping opens the recipe detail. Reused on the Recipes and cookbook screens.
 */
export function RecipeCard({ id, title, imageUrl }: { id: string; title: string; imageUrl?: string }) {
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.push(`/recipe/${id}`)}
      className="mb-4 overflow-hidden rounded-2xl border border-hairline bg-card"
      style={{ width: "48%" }}
    >
      {imageUrl ? (
        <Image source={{ uri: imageUrl }} contentFit="cover" transition={200} style={{ width: "100%", height: 120 }} />
      ) : (
        <View className="items-center justify-center bg-brand-light" style={{ width: "100%", height: 120 }}>
          <Icon name="restaurant-outline" size={30} color="#A85E2B" />
        </View>
      )}
      <VStack className="px-3 py-3">
        <Text className="text-base font-bold text-ink" numberOfLines={2}>
          {title}
        </Text>
      </VStack>
    </Pressable>
  );
}
