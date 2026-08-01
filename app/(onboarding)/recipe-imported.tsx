import React from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { OnboardingScreen } from "../../components/recime/OnboardingScreen";
import { Box, VStack, HStack, Text, Heading, Pressable, Center } from "../../components/ui";

const INGREDIENTS: { emoji: string; qty: string; rest: string }[] = [
  { emoji: "🫒", qty: "1 tablespoon", rest: "extra-virgin olive oil" },
  { emoji: "🥓", qty: "6 ounces", rest: "bacon roughly chopped" },
  { emoji: "🥩", qty: "3 pounds", rest: "beef brisket trimmed of fat, chuck steak or stewing beef cut into 2-inch chunks" },
  { emoji: "🥕", qty: "1", rest: "carrot large, sliced 1/2-inch thick" },
  { emoji: "🧅", qty: "1", rest: "white onion large, diced" },
  { emoji: "🧄", qty: "6 cloves", rest: "garlic minced (divided)" },
  { emoji: "🧂", qty: "1 pinch", rest: "coarse salt" },
  { emoji: "🌶️", qty: "1 pinch", rest: "ground pepper" },
  { emoji: "🥣", qty: "2 tablespoons", rest: "flour" },
  { emoji: "🧅", qty: "12", rest: "pearl onions small, optional" },
  { emoji: "🍷", qty: "3 cups", rest: "red wine like Merlot, Pinot Noir, or a Chianti" },
  { emoji: "🥩", qty: "2 cups", rest: "beef stock" },
  { emoji: "🥫", qty: "2 tablespoons", rest: "tomato paste" },
  { emoji: "🧊", qty: "1", rest: "beef bouillon cube crushed" },
  { emoji: "🌿", qty: "1 teaspoon", rest: "fresh thyme finely chopped" },
];

export default function RecipeImported() {
  const router = useRouter();
  const [servings, setServings] = React.useState(6);

  return (
    <OnboardingScreen
      progress={0.65}
      ctaLabel="Continue"
      onCta={() => router.push("/(onboarding)/website-import")}
    >
      <VStack space={4}>
        <View className="items-center">
          <Heading className="text-2xl">Recipe imported successfully!</Heading>
          <Text className="mt-2 text-center text-muted">✨ Just like magic ✨</Text>
        </View>

        <Box className="mt-4 rounded-2xl border border-hairline bg-white p-4">
          <HStack className="items-center" space={12}>
            <Center className="h-16 w-16 rounded-xl bg-gray-200">
              <Text className="text-2xl">🍲</Text>
            </Center>
            <Text className="flex-1 text-lg font-bold italic text-ink">Beef Bourguignon</Text>
          </HStack>

          <View className="my-4 h-px w-full bg-hairline" />

          <HStack className="items-center justify-between">
            <HStack className="items-center rounded-full border border-hairline bg-white px-1 py-1" space={8}>
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

            <Pressable className="flex-row items-center rounded-full border border-hairline bg-white px-4 py-2.5">
              <Ionicons name="swap-horizontal" size={18} color="#2E2419" />
              <Text className="ml-2 text-base font-medium text-ink">Convert</Text>
            </Pressable>
          </HStack>

          <Text className="mt-5 text-sm font-bold text-brand">INGREDIENTS</Text>

          <VStack className="mt-3" space={14}>
            {INGREDIENTS.map((item, i) => (
              <HStack key={i} className="items-start" space={12}>
                <Text className="text-lg">{item.emoji}</Text>
                <Text className="flex-1 text-base text-ink">
                  <Text className="font-bold text-ink">{item.qty}</Text> {item.rest}
                </Text>
              </HStack>
            ))}
          </VStack>
        </Box>
      </VStack>
    </OnboardingScreen>
  );
}
