import React from "react";
import { View, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { Image } from "expo-image";
import { Backdrop } from "../../components/recime/Backdrop";
import { Logo } from "../../components/recime/Logo";
import { NewCookbookSheet } from "../../components/recime/NewCookbookSheet";
import { listCookbooks } from "../../lib/api/cookbooks";
import type { ApiCookbook } from "../../lib/api/types";
import { Box, VStack, HStack, Center, Text, Pressable, Icon } from "../../components/ui";

export default function Recipes() {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [newCookbookOpen, setNewCookbookOpen] = React.useState(false);
  const [cookbooks, setCookbooks] = React.useState<ApiCookbook[] | null>(null);

  const load = React.useCallback(() => {
    listCookbooks()
      .then(setCookbooks)
      .catch(() => setCookbooks([]));
  }, []);

  // Refetch whenever the screen regains focus (after creating/importing).
  useFocusEffect(load);

  const startImport = () => {
    setMenuOpen(false);
    router.push("/import");
  };
  const addCookbook = () => {
    setMenuOpen(false);
    setNewCookbookOpen(true);
  };

  const isEmpty = cookbooks !== null && cookbooks.length === 0;

  return (
    <SafeAreaView className="flex-1 bg-cream" edges={["top"]}>
      <Backdrop />
      <HStack className="items-center justify-between px-5 pt-2">
        <Logo size={22} />
        <View className="h-8 w-8 rounded-full bg-sand" />
      </HStack>

      <View className="mt-3 flex-row items-center px-5">
        <Text className="text-2xl font-bold text-ink">Cookbooks</Text>
        <View className="ml-1">
          <Icon name="chevron-down" size={20} color="#2E2419" />
        </View>
      </View>

      {isEmpty ? (
        <Center className="flex-1 px-6">
          <Image
            source={require("../../assets/empty-recipes.png")}
            contentFit="contain"
            style={{ width: 240, height: 240, marginBottom: 12 }}
          />
          <Text className="text-center text-3xl font-bold text-ink">Let&apos;s get </Text>
          <Text className="mb-3 text-center text-4xl italic text-brand">cooking!</Text>
          <Text className="text-center text-muted">Create a cookbook or import your first recipe</Text>
          <View className="mt-6 self-end pr-6">
            <Icon name="return-down-forward" size={40} color="#A85E2B" />
          </View>
        </Center>
      ) : (
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ padding: 16, paddingBottom: 110 }}
          showsVerticalScrollIndicator={false}
        >
          <View className="flex-row flex-wrap justify-between">
            {(cookbooks ?? []).map((cb) => (
              <Pressable
                key={cb.id}
                onPress={() => router.push(`/cookbook/${cb.id}`)}
                className="mb-4 overflow-hidden rounded-2xl border border-hairline bg-card"
                style={{ width: "48%" }}
              >
                {cb.cover_image_url ? (
                  <Image source={{ uri: cb.cover_image_url }} contentFit="cover" style={{ width: "100%", height: 110 }} transition={200} />
                ) : (
                  <Center className="bg-brand-light" style={{ width: "100%", height: 110 }}>
                    <Icon name="book-outline" size={28} color="#A85E2B" />
                  </Center>
                )}
                <VStack className="px-3 py-3">
                  <Text className="text-base font-bold text-ink" numberOfLines={1}>
                    {cb.name}
                  </Text>
                  <Text className="text-xs text-muted">
                    {cb.recipe_count} {cb.recipe_count === 1 ? "recipe" : "recipes"}
                  </Text>
                </VStack>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      )}

      <Pressable
        className="absolute bottom-6 right-6 h-14 w-14 items-center justify-center rounded-full bg-brand shadow-lg"
        onPress={() => setMenuOpen(true)}
      >
        <Icon name="add" size={30} color="#fff" />
      </Pressable>

      {menuOpen ? (
        <Pressable className="absolute inset-0 bg-black/30" onPress={() => setMenuOpen(false)}>
          <View className="absolute inset-x-0 bottom-0">
            <Pressable onPress={() => {}}>
              <Box className="rounded-t-3xl bg-card px-5 pb-10 pt-6">
                <VStack space={12}>
                  <Pressable onPress={startImport} className="flex-row items-center rounded-2xl bg-brand px-4 py-4">
                    <Text className="text-2xl">🔗</Text>
                    <VStack className="ml-3">
                      <Text className="text-base font-semibold text-white">Import from a link</Text>
                      <Text className="text-sm" style={{ color: "#F6E9DC" }}>
                        Paste a web, Instagram, TikTok, Pinterest or YouTube link
                      </Text>
                    </VStack>
                  </Pressable>

                  <Pressable
                    onPress={addCookbook}
                    className="flex-row items-center rounded-2xl border border-hairline bg-card px-4 py-4"
                  >
                    <Text className="text-2xl">📕</Text>
                    <Text className="ml-3 text-base font-semibold text-ink">Add a cookbook</Text>
                  </Pressable>
                </VStack>
              </Box>
            </Pressable>
          </View>
        </Pressable>
      ) : null}

      <NewCookbookSheet visible={newCookbookOpen} onClose={() => setNewCookbookOpen(false)} onCreated={load} />
    </SafeAreaView>
  );
}
