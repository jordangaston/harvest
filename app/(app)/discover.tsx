import React from "react";
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Backdrop } from "../../components/recime/Backdrop";
import { Box, VStack, HStack, Center, ScrollView, Text, Heading, Pressable, Icon } from "../../components/ui";
import { ELEVATION } from "../../lib/elevation";

const CHIPS = [
  "🌱 Vegan",
  "⚡ Easy",
  "🍲 Soup",
  "🍽 Dinner",
  "Indian",
  "Comfort food",
  "Italian",
  "Meal prep",
];

// soft golden-hour pastel fills, cycled across chips (espresso text ≈ 11:1)
const CHIP_TINTS = ["#F6DDC8", "#F1E3BE", "#DCE0C9", "#EFD3CC", "#F5D9BE", "#DDE6E2"];

const CREATORS = [
  { name: "thecontrarian…", recipes: 86 },
  { name: "lucymakes…", recipes: 138 },
  { name: "vinniecook…", recipes: 61 },
  { name: "calwillcook…", recipes: 172 },
  { name: "revskitche…", recipes: 155 },
];

const RECIPES = [
  { emoji: "🥬", title: "VIRAL DIRTY CABBAGE!!", meta: "low.carb.love · 4.7K saves" },
  { emoji: "🥗", title: "10-MINUTE CHINESE…", meta: "kalejunkie · 1.7K saves" },
];

export default function Discover() {
  return (
    <SafeAreaView className="flex-1 bg-cream" edges={["top"]}>
      <Backdrop />
      <ScrollView className="flex-1" contentContainerClassName="pb-10">
        <View className="px-5 pt-2">
          <Heading className="text-2xl">Discover</Heading>
        </View>

        <View className="px-5 pt-4">
          <HStack className="h-12 items-center rounded-full border border-hairline px-4" space={8}>
            <Icon name="search" size={20} color="#6E5B48" />
            <Text className="text-muted">What would you like to cook?</Text>
          </HStack>
        </View>

        <View className="px-5 pt-6">
          <Text className="mb-3 text-base font-bold text-ink">Popular searches</Text>
          <View className="flex-row flex-wrap gap-2">
            {CHIPS.map((chip, i) => (
              <View
                key={chip}
                className="rounded-full px-3.5 py-2"
                style={{ backgroundColor: CHIP_TINTS[i % CHIP_TINTS.length] }}
              >
                <Text className="text-sm font-medium text-ink">{chip}</Text>
              </View>
            ))}
          </View>
        </View>

        <View className="px-5 pt-6">
          <Box className="rounded-2xl border border-hairline bg-card p-4" style={ELEVATION.low}>
            <Center className="mb-4 h-40 w-full rounded-2xl bg-sand">
              <Text className="text-5xl">🍋</Text>
            </Center>
            <Text className="text-lg font-bold text-ink">No-Churn Lemon Ice Cream</Text>
            <Text className="mt-1 text-muted">★ 4.2 · 1.9K</Text>
            <Text className="mt-2 text-muted">
              Silky, creamy, and cool with a bright, puckery citrus finish.
            </Text>
          </Box>
        </View>

        <View className="px-5 pt-8">
          <HStack className="items-center justify-between">
            <Text className="text-base font-bold text-ink">Trending Creators</Text>
            <Pressable>
              <Text className="font-semibold text-brand">See all</Text>
            </Pressable>
          </HStack>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mt-4">
            <HStack space={16}>
              {CREATORS.map((creator) => (
                <VStack key={creator.name} className="w-20 items-center" space={6}>
                  <View className="h-16 w-16 rounded-full bg-sand" />
                  <Text className="text-center text-xs font-semibold text-ink" numberOfLines={1}>
                    {creator.name}
                  </Text>
                  <Text className="text-center text-xs text-muted">{creator.recipes} recipes</Text>
                </VStack>
              ))}
            </HStack>
          </ScrollView>
        </View>

        <View className="px-5 pt-8">
          <Box className="rounded-2xl bg-brand/10 p-5">
            <Text className="text-lg font-bold text-ink">Import recipes from anywhere</Text>
            <Text className="mt-1 text-muted">Go to Recipes and tap ⊕</Text>
          </Box>
        </View>

        <View className="px-5 pt-8">
          <HStack space={12}>
            {RECIPES.map((recipe) => (
              <VStack key={recipe.title} className="flex-1" space={6}>
                <Center className="h-28 w-full rounded-2xl bg-sand">
                  <Text className="text-4xl">{recipe.emoji}</Text>
                </Center>
                <Text className="text-sm font-bold text-ink" numberOfLines={1}>
                  {recipe.title}
                </Text>
                <Text className="text-xs text-muted">{recipe.meta}</Text>
              </VStack>
            ))}
          </HStack>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
