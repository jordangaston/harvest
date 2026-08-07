import React from "react";
import { View, ScrollView, StyleSheet, useWindowDimensions } from "react-native";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { VStack, HStack, Center, Text, Heading, Pressable, Button, ButtonText, Icon, Spinner } from "../components/ui";
import { CookbookPickerSheet } from "../components/recime/CookbookPickerSheet";
import { resolveIcon } from "../components/recime/recipes";
import { getRecipe } from "../lib/api/recipes";
import type { ApiRecipe } from "../lib/api/types";

/** One recipe's preview page inside the carousel: blur-fill hero, title, and its
 * ingredients. Each recipe is saved on its own from the footer, so a slideshow's
 * recipes can each go to a different cookbook. */
function RecipePreviewPage({ recipe }: { recipe: ApiRecipe }) {
  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
      <View className="bg-brand-light" style={{ width: "100%", height: 220 }}>
        {recipe.image_url ? (
          <>
            <Image source={{ uri: recipe.image_url }} contentFit="cover" blurRadius={28} style={StyleSheet.absoluteFill} />
            <Image source={{ uri: recipe.image_url }} contentFit="contain" style={StyleSheet.absoluteFill} />
          </>
        ) : (
          <Center style={StyleSheet.absoluteFill}>
            <Icon name="restaurant-outline" size={56} color="#A85E2B" />
          </Center>
        )}
      </View>
      <VStack className="px-6 pt-4" space={12}>
        <Heading className="text-2xl">{recipe.title}</Heading>
        <VStack space={10}>
          <Text className="text-base font-bold text-ink">INGREDIENTS</Text>
          {recipe.ingredients.map((ing, idx) => (
            <HStack key={idx} className="items-center" space={12}>
              <Image source={resolveIcon(ing.icon)} contentFit="cover" style={{ width: 36, height: 36, borderRadius: 9 }} />
              <Text className="flex-1 text-base text-ink">{ing.name}</Text>
            </HStack>
          ))}
        </VStack>
        {recipe.steps.length > 0 ? (
          <VStack space={12}>
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
        ) : null}
      </VStack>
    </ScrollView>
  );
}

export default function Preview() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { ids } = useLocalSearchParams<{ ids: string }>();
  const idList = React.useMemo(() => (ids ? ids.split(",").filter(Boolean) : []), [ids]);

  const [recipes, setRecipes] = React.useState<(ApiRecipe | null)[] | null>(null);
  const [page, setPage] = React.useState(0);
  // Which recipe's cookbook picker is open, and where each recipe was filed.
  const [pickerFor, setPickerFor] = React.useState<string | null>(null);
  const [savedNames, setSavedNames] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    Promise.all(idList.map((id) => getRecipe(id).catch(() => null))).then(setRecipes);
  }, [idList]);

  if (!recipes) {
    return (
      <Center className="flex-1 bg-cream">
        <Spinner />
      </Center>
    );
  }

  const currentId = idList[page];
  const currentSaved = currentId ? savedNames[currentId] : undefined;

  return (
    <SafeAreaView className="flex-1 bg-cream" edges={["top", "bottom"]}>
      <HStack className="items-center justify-between px-5 pt-1">
        <Pressable onPress={() => router.replace("/(app)/recipes")} className="p-1">
          <Icon name="close" size={26} color="#2E2419" />
        </Pressable>
        <Text className="text-sm font-semibold text-muted">
          {page + 1} / {idList.length}
        </Text>
        <View className="w-8" />
      </HStack>
      <Text className="px-6 pb-2 pt-1 text-center text-sm text-muted">
        We found {idList.length} recipes — save each to a cookbook.
      </Text>

      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / width))}
      >
        {idList.map((id, i) => {
          const recipe = recipes[i];
          return (
            <View key={id} style={{ width }}>
              {recipe ? (
                <RecipePreviewPage recipe={recipe} />
              ) : (
                <Center className="flex-1 px-8">
                  <Text className="text-center text-muted">This recipe couldn&apos;t be loaded.</Text>
                </Center>
              )}
            </View>
          );
        })}
      </ScrollView>

      <View className="border-t border-hairline bg-cream px-6 pb-2 pt-3">
        {currentSaved ? (
          <HStack className="items-center justify-between rounded-full border border-brand bg-brand-light px-5 py-3.5">
            <HStack className="flex-1 items-center" space={8}>
              <Icon name="checkmark-circle" size={20} color="#8A4A1E" />
              <Text className="text-base font-semibold text-brand-dark" numberOfLines={1}>
                Saved to {currentSaved}
              </Text>
            </HStack>
            <Pressable onPress={() => setPickerFor(currentId!)} className="pl-3">
              <Text className="font-semibold text-brand-dark">Change</Text>
            </Pressable>
          </HStack>
        ) : (
          <Button className="w-full" onPress={() => setPickerFor(currentId!)} disabled={!currentId}>
            <Icon name="bookmark" size={18} color="#fff" />
            <ButtonText className="ml-2">Save to cookbook</ButtonText>
          </Button>
        )}
      </View>

      <CookbookPickerSheet
        visible={pickerFor !== null}
        recipeIds={pickerFor ? [pickerFor] : []}
        onClose={() => setPickerFor(null)}
        onSaved={(names) => {
          const label = names.length === 1 ? names[0] : `${names.length} cookbooks`;
          if (pickerFor) setSavedNames((prev) => ({ ...prev, [pickerFor]: label }));
          setPickerFor(null);
        }}
      />
    </SafeAreaView>
  );
}
