import React from "react";
import { View, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Backdrop } from "../../components/recime/Backdrop";
import { Logo } from "../../components/recime/Logo";
import { useSavedRecipes } from "../../components/recime/recipes";
import { Box, VStack, HStack, Center, Text, Pressable, Icon, Image } from "../../components/ui";

export default function Recipes() {
  const router = useRouter();
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const recipes = useSavedRecipes();

  const addRecipe = () => {
    setSheetOpen(false);
    router.push("/import");
  };

  return (
    <SafeAreaView className="flex-1 bg-cream" edges={["top"]}>
      <Backdrop />
      <HStack className="items-center justify-between px-5 pt-2">
        <Logo size={22} />
        <View className="h-8 w-8 rounded-full bg-sand" />
      </HStack>

      <Pressable className="mt-3 flex-row items-center px-5">
        <Text className="text-2xl font-bold text-ink">Cookbooks</Text>
        <View className="ml-1">
          <Icon name="chevron-down" size={20} color="#2E2419" />
        </View>
      </Pressable>

      {recipes.length === 0 ? (
        <Center className="flex-1 px-6">
          <Text className="mb-6 text-muted">No recipes added</Text>
          <Image
            source={require("../../assets/empty-recipes.png")}
            resizeMode="contain"
            className="mb-4 h-64 w-64"
          />
          <Text className="text-center text-3xl font-bold text-ink">Let&apos;s get </Text>
          <Text className="mb-3 text-center text-4xl italic text-brand">cooking!</Text>
          <Text className="text-center text-muted">Start by adding your first recipe</Text>
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
            {recipes.map((r) => (
              <Pressable
                key={r.id}
                onPress={() => router.push(`/recipe/${r.id}`)}
                className="mb-4 overflow-hidden rounded-2xl border border-hairline bg-card"
                style={{ width: "48%" }}
              >
                <Image source={r.image} resizeMode="cover" style={{ width: "100%", height: 120 }} />
                <VStack className="px-3 py-3" space={4}>
                  <Text className="text-base font-bold text-ink" numberOfLines={2}>
                    {r.title}
                  </Text>
                  <HStack className="items-center" space={4}>
                    <Icon name="star" size={13} color="#9E7620" />
                    <Text className="text-xs text-muted">
                      {r.rating} · {r.time}
                    </Text>
                  </HStack>
                </VStack>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      )}

      <Pressable
        className="absolute bottom-6 right-6 h-14 w-14 items-center justify-center rounded-full bg-brand shadow-lg"
        onPress={() => setSheetOpen(true)}
      >
        <Icon name="add" size={30} color="#fff" />
      </Pressable>

      {sheetOpen ? (
        <Pressable className="absolute inset-0 bg-black/30" onPress={() => setSheetOpen(false)}>
          <View className="absolute inset-x-0 bottom-0">
            <Pressable onPress={() => {}}>
              <Box className="rounded-t-3xl bg-cream px-5 pb-10 pt-6">
                <VStack space={12}>
                  <Pressable
                    onPress={addRecipe}
                    className="flex-row items-center rounded-2xl bg-brand px-4 py-4"
                  >
                    <Text className="text-2xl">📄</Text>
                    <VStack className="ml-3">
                      <Text className="text-base font-semibold text-white">Add a Recipe</Text>
                      <Text className="text-sm" style={{ color: "#F6E9DC" }}>
                        Import from anywhere
                      </Text>
                    </VStack>
                  </Pressable>

                  <HStack className="items-center rounded-2xl border border-hairline bg-card px-4 py-4" space={12}>
                    <Text className="text-2xl">📕</Text>
                    <Text className="text-base font-semibold text-ink">Add a Cookbook</Text>
                  </HStack>
                </VStack>
              </Box>
            </Pressable>
          </View>
        </Pressable>
      ) : null}
    </SafeAreaView>
  );
}
