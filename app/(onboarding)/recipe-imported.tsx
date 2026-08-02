import React from "react";
import { View, Image } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { OnboardingScreen } from "../../components/recime/OnboardingScreen";
import { RECIPES_BY_ID, SAMPLE_RECIPE } from "../../components/recime/recipes";
import { Box, VStack, HStack, Center, Text, Heading, Pressable } from "../../components/ui";

// Where to go after each recipe's success screen: the social import chains into
// the website demo; the website import continues to the age step.
const NEXT_ROUTE: Record<string, string> = {
  "beef-bourguignon": "/(onboarding)/website-import",
  "banana-walnut-bread": "/(onboarding)/age",
};

export default function RecipeImported() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const recipe = (id && RECIPES_BY_ID[id]) || SAMPLE_RECIPE;
  const [servings, setServings] = React.useState(recipe.servings);

  return (
    <OnboardingScreen
      progress={recipe.id === "banana-walnut-bread" ? 0.72 : 0.65}
      ctaLabel="Continue"
      onCta={() => router.push(NEXT_ROUTE[recipe.id] ?? "/(onboarding)/age")}
    >
      <VStack space={4}>
        <View className="items-center">
          <Text className="text-2xl">🎉 🎊 ✨</Text>
          <Heading className="mt-2 text-center text-2xl">Recipe imported successfully!</Heading>
          <Text className="mt-1 text-muted">✨ Just like magic ✨</Text>
        </View>

        <Box className="mt-4 rounded-2xl border border-hairline bg-card p-4">
          {/* recipe header */}
          <HStack className="items-center" space={12}>
            <Image source={recipe.image} resizeMode="cover" style={{ width: 60, height: 60, borderRadius: 12 }} />
            <Text className="flex-1 text-lg font-bold italic text-ink">{recipe.title}</Text>
          </HStack>

          <View className="my-4 h-px w-full bg-hairline" />

          {/* servings + convert */}
          <HStack className="items-center justify-between">
            <HStack className="items-center rounded-full border border-hairline bg-card px-1 py-1" space={8}>
              <Pressable
                className="h-8 w-8 items-center justify-center rounded-full bg-cream"
                onPress={() => setServings((s) => Math.max(1, s - 1))}
              >
                <Ionicons name="remove" size={18} color="#2E2419" />
              </Pressable>
              <Text className="min-w-[24px] text-center text-base font-semibold text-ink">{servings}</Text>
              <Pressable
                className="h-8 w-8 items-center justify-center rounded-full bg-cream"
                onPress={() => setServings((s) => s + 1)}
              >
                <Ionicons name="add" size={18} color="#2E2419" />
              </Pressable>
              <Text className="pl-1 pr-2 text-base text-muted">servings</Text>
            </HStack>

            <Pressable className="flex-row items-center rounded-full border border-hairline bg-card px-4 py-2.5">
              <Ionicons name="swap-horizontal" size={18} color="#2E2419" />
              <Text className="ml-2 text-base font-medium text-ink">Convert</Text>
            </Pressable>
          </HStack>

          {/* ingredients */}
          <Text className="mt-5 text-sm font-bold text-brand">INGREDIENTS</Text>
          <VStack className="mt-3" space={12}>
            {recipe.ingredients.map((item, i) => (
              <HStack key={i} className="items-center" space={12}>
                <Image
                  source={item.icon}
                  resizeMode="cover"
                  style={{ width: 40, height: 40, borderRadius: 10 }}
                />
                <Text className="flex-1 text-base text-ink">{item.text}</Text>
              </HStack>
            ))}
          </VStack>

          {/* instructions */}
          <Text className="mt-6 text-sm font-bold text-brand">INSTRUCTIONS</Text>
          <VStack className="mt-3" space={14}>
            {recipe.steps.map((step, i) => (
              <HStack key={i} className="items-start" space={12}>
                <Center className="mt-0.5 h-6 w-6 rounded-full bg-brand">
                  <Text className="text-xs font-bold text-white">{i + 1}</Text>
                </Center>
                <Text className="flex-1 text-base text-ink">{step}</Text>
              </HStack>
            ))}
          </VStack>
        </Box>
      </VStack>
    </OnboardingScreen>
  );
}
