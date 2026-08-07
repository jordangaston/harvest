import React from "react";
import { View, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { Backdrop } from "../../components/recime/Backdrop";
import { RecipeCard } from "../../components/recime/RecipeCard";
import { getCookbook } from "../../lib/api/cookbooks";
import type { CookbookView } from "../../lib/api/types";
import { VStack, HStack, Center, Text, Pressable, Icon } from "../../components/ui";

export default function CookbookScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [data, setData] = React.useState<CookbookView | null>(null);
  const [notFound, setNotFound] = React.useState(false);

  const load = React.useCallback(() => {
    if (!id) return;
    getCookbook(id)
      .then(setData)
      .catch(() => setNotFound(true));
  }, [id]);
  useFocusEffect(load);

  return (
    <SafeAreaView className="flex-1 bg-cream" edges={["top"]}>
      <Backdrop />
      <HStack className="items-center px-4 pt-2" space={4}>
        <Pressable onPress={() => router.back()} className="p-1">
          <Icon name="chevron-back" size={26} color="#2E2419" />
        </Pressable>
        <VStack>
          <Text className="text-xl font-bold text-ink">{data?.cookbook.name ?? (notFound ? "Not found" : "…")}</Text>
          {data ? (
            <Text className="text-xs text-muted">
              {data.recipes.length} {data.recipes.length === 1 ? "recipe" : "recipes"}
            </Text>
          ) : null}
        </VStack>
      </HStack>

      {notFound ? (
        <Center className="flex-1 px-8">
          <Text className="text-center text-muted">This cookbook couldn&apos;t be found.</Text>
        </Center>
      ) : data && data.recipes.length === 0 ? (
        <Center className="flex-1 px-8">
          <Text className="mb-1 text-center text-2xl font-bold text-ink">No recipes yet</Text>
          <Text className="text-center text-muted">Import a recipe and save it into this cookbook.</Text>
        </Center>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
          <View className="flex-row flex-wrap justify-between">
            {(data?.recipes ?? []).map((r) => (
              <RecipeCard key={r.id} id={r.id} title={r.title} imageUrl={r.image_url} />
            ))}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
