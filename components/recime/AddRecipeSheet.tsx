import React from "react";
import { Modal, View, ScrollView } from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Box, HStack, VStack, Text, Pressable, Icon, Input, Center, Spinner } from "../ui";
import { IngredientFilterSheet } from "./IngredientFilterSheet";
import { TotalTimeSheet } from "./TotalTimeSheet";
import { useLibraryCards, useCookbooks, useAddMealPlanEntry } from "../../lib/api/hooks";
import { filterCards } from "../../lib/filterCards";
import { mealLabel } from "./meals";
import type { MealSlot, RecipeCard } from "../../lib/api/types";

/**
 * The "Add to <Meal>" sheet. Level 1 is a cookbook grid (a synthetic "All recipes"
 * tile + the caller's cookbooks); tapping one shows its recipe cards, filtered by
 * search, ingredients (AND), and total time — all client-side over the library.
 * Picking a recipe assigns it to the given date+meal.
 */
export function AddRecipeSheet({
  visible,
  date,
  meal,
  onAdded,
  onClose,
}: {
  visible: boolean;
  date: string;
  meal: MealSlot;
  onAdded: (meal: MealSlot) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { data: cards, isLoading: cardsLoading } = useLibraryCards();
  const { data: cookbooks } = useCookbooks();
  const add = useAddMealPlanEntry();

  const [cookbookId, setCookbookId] = React.useState<string | undefined>(undefined);
  const [inList, setInList] = React.useState(false); // false = cookbook grid, true = recipe list
  const [search, setSearch] = React.useState("");
  const [ingredients, setIngredients] = React.useState<string[]>([]);
  const [maxMinutes, setMaxMinutes] = React.useState<number | undefined>(undefined);
  const [ingOpen, setIngOpen] = React.useState(false);
  const [timeOpen, setTimeOpen] = React.useState(false);

  // Reset to the cookbook grid with no filters each open — the instance is reused
  // for every day/meal, so nothing must carry over (rn-nativewind-pitfalls).
  React.useEffect(() => {
    if (visible) {
      setCookbookId(undefined);
      setInList(false);
      setSearch("");
      setIngredients([]);
      setMaxMinutes(undefined);
      setIngOpen(false);
      setTimeOpen(false);
    }
  }, [visible]);

  const library = cards ?? [];
  const shown = filterCards(library, { search, ingredients, maxMinutes, cookbookId });

  const pickRecipe = async (r: RecipeCard) => {
    if (add.isPending) return;
    try {
      await add.mutateAsync({ date, meal, recipeId: r.id });
      onAdded(meal);
    } catch {
      // leave the sheet open so the user can retry
    }
  };

  const openCookbook = (id?: string) => {
    setCookbookId(id);
    setInList(true);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/30" onPress={onClose}>
        <View className="mt-auto">
          <Pressable onPress={() => {}}>
            <Box className="rounded-t-3xl bg-cream px-5 pt-4" style={{ paddingBottom: insets.bottom + 16, height: "88%" }}>
              <View className="mb-3 h-1.5 w-10 self-center rounded-full bg-hairline" />
              <HStack className="mb-3 items-center justify-between">
                <HStack className="items-center" space={8}>
                  {inList ? (
                    <Pressable onPress={() => setInList(false)} className="p-1">
                      <Icon name="chevron-back" size={22} color="#2E2419" />
                    </Pressable>
                  ) : null}
                  <Text className="text-lg font-bold text-ink">Add to {mealLabel(meal)}</Text>
                </HStack>
                <Pressable onPress={onClose}>
                  <Icon name="close" size={22} color="#6E5B48" />
                </Pressable>
              </HStack>

              {!inList ? (
                <CookbookGrid
                  library={library}
                  cookbooks={(cookbooks ?? []).map((c) => ({ id: c.id, name: c.name, count: c.recipe_count, cover: c.cover_image_url }))}
                  onOpen={openCookbook}
                />
              ) : (
                <>
                  <Input placeholder="Search recipes" value={search} onChangeText={setSearch} className="mb-2" />
                  <HStack className="mb-3" space={8}>
                    <FilterChip
                      label={ingredients.length ? `Ingredients (${ingredients.length})` : "Ingredients"}
                      active={ingredients.length > 0}
                      onPress={() => setIngOpen(true)}
                    />
                    <FilterChip
                      label={maxMinutes ? `Under ${maxMinutes} mins` : "Total time"}
                      active={maxMinutes != null}
                      onPress={() => setTimeOpen(true)}
                    />
                  </HStack>
                  {cardsLoading ? (
                    <Center className="flex-1"><Spinner /></Center>
                  ) : (
                    <ScrollView showsVerticalScrollIndicator={false}>
                      {shown.length === 0 ? (
                        <Text className="px-1 py-8 text-center text-muted">No recipes match these filters.</Text>
                      ) : (
                        shown.map((r) => (
                          <Pressable
                            key={r.id}
                            onPress={() => pickRecipe(r)}
                            className="mb-2 flex-row items-center rounded-2xl border border-hairline bg-card p-2.5"
                          >
                            <Thumb uri={r.image_url} />
                            <VStack className="ml-3 flex-1">
                              <Text className="text-base font-semibold text-ink" numberOfLines={2}>{r.title}</Text>
                              {r.total_minutes != null ? <Text className="text-xs text-muted">{r.total_minutes} min</Text> : null}
                            </VStack>
                            <Icon name="add-circle" size={26} color="#A85E2B" />
                          </Pressable>
                        ))
                      )}
                      <View className="h-4" />
                    </ScrollView>
                  )}
                </>
              )}
            </Box>
          </Pressable>
        </View>
      </Pressable>

      <IngredientFilterSheet
        visible={ingOpen}
        selected={ingredients}
        onApply={(next) => {
          setIngredients(next);
          setIngOpen(false);
        }}
        onClose={() => setIngOpen(false)}
      />
      <TotalTimeSheet
        visible={timeOpen}
        value={maxMinutes}
        onApply={(next) => {
          setMaxMinutes(next);
          setTimeOpen(false);
        }}
        onClose={() => setTimeOpen(false)}
      />
    </Modal>
  );
}

function CookbookGrid({
  library,
  cookbooks,
  onOpen,
}: {
  library: RecipeCard[];
  cookbooks: { id: string; name: string; count: number; cover?: string }[];
  onOpen: (id?: string) => void;
}) {
  const allCover = library.find((r) => r.image_url)?.image_url;
  const tiles = [
    { id: undefined as string | undefined, name: "All recipes", count: library.length, cover: allCover },
    ...cookbooks,
  ];
  return (
    <ScrollView showsVerticalScrollIndicator={false}>
      <View className="flex-row flex-wrap justify-between">
        {tiles.map((t) => (
          <Pressable key={t.id ?? "all"} onPress={() => onOpen(t.id)} className="mb-4" style={{ width: "48%" }}>
            <View className="aspect-square overflow-hidden rounded-2xl border border-hairline bg-brand-light">
              {t.cover ? (
                <Image source={{ uri: t.cover }} contentFit="cover" style={{ width: "100%", height: "100%" }} />
              ) : (
                <Center className="flex-1"><Icon name="book-outline" size={40} color="#A85E2B" /></Center>
              )}
            </View>
            <Text className="mt-1.5 text-base font-semibold text-ink" numberOfLines={1}>{t.name}</Text>
            <Text className="text-xs text-muted">{t.count} {t.count === 1 ? "recipe" : "recipes"}</Text>
          </Pressable>
        ))}
      </View>
      <View className="h-4" />
    </ScrollView>
  );
}

function FilterChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className={`flex-row items-center rounded-full border px-3 py-1.5 ${active ? "border-brand bg-brand-light" : "border-hairline bg-card"}`}
    >
      <Text className="text-sm font-semibold text-ink">{label}</Text>
      <Icon name="chevron-down" size={14} color="#6E5B48" />
    </Pressable>
  );
}

function Thumb({ uri }: { uri?: string }) {
  if (!uri) {
    return (
      <Center className="h-14 w-14 rounded-xl bg-brand-light">
        <Icon name="restaurant-outline" size={22} color="#A85E2B" />
      </Center>
    );
  }
  return <Image source={{ uri }} contentFit="cover" style={{ width: 56, height: 56, borderRadius: 12 }} />;
}
