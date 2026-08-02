import React from "react";
import { View, Image, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
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
} from "../../components/ui";
import {
  SAMPLE_RECIPE,
  saveRecipe,
  useSavedRecipes,
  type Recipe,
} from "../../components/recime/recipes";

export default function RecipeDetail() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const saved = useSavedRecipes();

  const recipe: Recipe = saved.find((r) => r.id === id) ?? SAMPLE_RECIPE;
  const isSaved = saved.some((r) => r.id === recipe.id);

  const [servings, setServings] = React.useState(recipe.servings);

  const onSave = () => {
    saveRecipe(recipe);
    router.navigate("/(app)/recipes");
  };

  return (
    <View className="flex-1 bg-cream">
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>
        {/* hero */}
        <View>
          <Image source={recipe.image} resizeMode="cover" style={{ width: "100%", height: 300 }} />
          <Pressable
            onPress={() => router.back()}
            style={{ position: "absolute", top: insets.top + 6, left: 16 }}
            className="h-10 w-10 items-center justify-center rounded-full bg-black/40"
          >
            <Icon name="chevron-back" size={24} color="#fff" />
          </Pressable>
        </View>

        <VStack className="px-6 pt-5" space={12}>
          <View>
            <Text className="text-sm font-semibold text-brand-dark">{recipe.source}</Text>
            <Heading className="mt-1 text-3xl">{recipe.title}</Heading>
            <HStack className="mt-2 items-center" space={16}>
              <HStack className="items-center" space={4}>
                <Icon name="star" size={16} color="#9E7620" />
                <Text className="text-muted">{recipe.rating}</Text>
              </HStack>
              <HStack className="items-center" space={4}>
                <Icon name="time-outline" size={16} color="#6E5B48" />
                <Text className="text-muted">{recipe.time}</Text>
              </HStack>
            </HStack>
          </View>

          {/* servings + convert */}
          <HStack className="items-center justify-between">
            <HStack className="items-center rounded-full border border-hairline bg-card px-1 py-1" space={8}>
              <Pressable
                onPress={() => setServings((s) => Math.max(1, s - 1))}
                className="h-8 w-8 items-center justify-center rounded-full bg-cream"
              >
                <Icon name="remove" size={18} color="#2E2419" />
              </Pressable>
              <Text className="min-w-[70px] text-center text-base font-semibold text-ink">
                {servings} servings
              </Text>
              <Pressable
                onPress={() => setServings((s) => s + 1)}
                className="h-8 w-8 items-center justify-center rounded-full bg-cream"
              >
                <Icon name="add" size={18} color="#2E2419" />
              </Pressable>
            </HStack>
            <Pressable className="flex-row items-center rounded-full border border-hairline bg-card px-4 py-2.5">
              <Icon name="swap-horizontal" size={18} color="#2E2419" />
              <Text className="ml-1.5 font-semibold text-ink">Convert</Text>
            </Pressable>
          </HStack>

          {/* ingredients */}
          <VStack className="mt-2" space={10}>
            <Text className="text-base font-bold text-ink">INGREDIENTS</Text>
            {recipe.ingredients.map((ing, i) => (
              <HStack key={i} className="items-center" space={12}>
                <Image
                  source={ing.icon}
                  resizeMode="cover"
                  style={{ width: 40, height: 40, borderRadius: 10 }}
                />
                <Text className="flex-1 text-base text-ink">{ing.text}</Text>
              </HStack>
            ))}
          </VStack>

          {/* instructions */}
          <VStack className="mt-4" space={12}>
            <Text className="text-base font-bold text-ink">INSTRUCTIONS</Text>
            {recipe.steps.map((step, i) => (
              <HStack key={i} className="items-start" space={12}>
                <Center className="mt-0.5 h-7 w-7 rounded-full bg-brand">
                  <Text className="text-sm font-bold text-white">{i + 1}</Text>
                </Center>
                <Text className="flex-1 text-base text-ink">{step}</Text>
              </HStack>
            ))}
          </VStack>
        </VStack>
      </ScrollView>

      {/* sticky save */}
      <View
        className="absolute inset-x-0 bottom-0 border-t border-hairline bg-cream px-6 pt-3"
        style={{ paddingBottom: insets.bottom + 10 }}
      >
        {isSaved ? (
          <Button action="dark" className="w-full" onPress={() => router.navigate("/(app)/recipes")}>
            <Icon name="checkmark" size={20} color="#fff" />
            <ButtonText className="ml-2">Saved to your recipes</ButtonText>
          </Button>
        ) : (
          <Button className="w-full" onPress={onSave}>
            <Icon name="bookmark" size={18} color="#fff" />
            <ButtonText className="ml-2">Save to cookbook</ButtonText>
          </Button>
        )}
      </View>
    </View>
  );
}
