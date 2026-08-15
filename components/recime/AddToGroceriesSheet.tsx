import React from "react";
import { View, Modal, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { HStack, VStack, Text, Pressable, Button, ButtonText, Icon } from "../ui";
import { resolveIcon } from "./recipes";
import { scaleAmount, formatQuantity } from "../../lib/grocery/scale";
import { useAddGroceryItems } from "../../lib/api/hooks";
import type { ApiRecipe } from "../../lib/api/types";

/** "Add to groceries" sheet on the recipe screen: adjust servings (scales every
 * amount), uncheck what you already have, then add the checked items to the list —
 * each tagged with the source recipe. Reports the count added so the host can toast. */
export function AddToGroceriesSheet({
  visible,
  recipe,
  onClose,
  onAdded,
}: {
  visible: boolean;
  recipe: ApiRecipe;
  onClose: () => void;
  onAdded: (count: number) => void;
}) {
  const insets = useSafeAreaInsets();
  const addItems = useAddGroceryItems();
  const baseServings = recipe.servings && recipe.servings > 0 ? recipe.servings : null;
  const [servings, setServings] = React.useState(baseServings ?? 1);
  const [excluded, setExcluded] = React.useState<Set<number>>(new Set());

  // Reset selection/servings whenever the sheet reopens (reused instance).
  React.useEffect(() => {
    if (visible) {
      setServings(baseServings ?? 1);
      setExcluded(new Set());
    }
  }, [visible, baseServings]);

  const ratio = baseServings ? servings / baseServings : 1;
  const toggle = (i: number) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });

  const selectedCount = recipe.ingredients.length - excluded.size;

  const scaledAmount = (i: number) => {
    const raw = recipe.ingredients[i]!.amount;
    return scaleAmount(raw != null ? Number(raw) : null, ratio);
  };

  const add = () => {
    const items = recipe.ingredients
      .map((ing, i) => ({ ing, i }))
      .filter(({ i }) => !excluded.has(i))
      .map(({ ing, i }) => {
        const amount = scaledAmount(i);
        return {
          name: ing.name,
          amount,
          unit: ing.unit ?? null,
          quantity_text: amount == null ? (ing.quantity_text ?? null) : null,
          source_recipe_id: recipe.id,
        };
      });
    if (items.length === 0) return;
    addItems.mutate(items, { onSuccess: () => onAdded(items.length) });
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/30" onPress={onClose}>
        <View className="mt-auto max-h-[85%]">
          <Pressable onPress={() => {}}>
            <View className="rounded-t-3xl bg-cream px-5 pt-6" style={{ paddingBottom: insets.bottom + 16 }}>
              <View className="mb-4 h-1.5 w-10 self-center rounded-full bg-hairline" />
              <Text className="mb-3 text-center text-base font-semibold text-ink">Add items</Text>

              {baseServings ? (
                <HStack className="mb-3 items-center justify-center" space={16}>
                  <Pressable onPress={() => setServings((s) => Math.max(1, s - 1))} className="h-9 w-9 items-center justify-center rounded-full bg-card">
                    <Icon name="remove" size={20} color="#2E2419" />
                  </Pressable>
                  <Text className="text-base font-semibold text-ink">{servings} servings</Text>
                  <Pressable onPress={() => setServings((s) => s + 1)} className="h-9 w-9 items-center justify-center rounded-full bg-card">
                    <Icon name="add" size={20} color="#2E2419" />
                  </Pressable>
                </HStack>
              ) : null}

              <HStack className="mb-2 items-center justify-between px-1">
                <Text className="text-xs font-bold text-ink">INGREDIENTS</Text>
                <Pressable
                  onPress={() =>
                    setExcluded((prev) =>
                      prev.size === recipe.ingredients.length ? new Set() : new Set(recipe.ingredients.map((_, i) => i)),
                    )
                  }
                >
                  <Text className="text-sm font-semibold text-brand-dark">
                    {excluded.size === recipe.ingredients.length ? "Select all" : "Deselect all"}
                  </Text>
                </Pressable>
              </HStack>

              <ScrollView className="max-h-[46vh]">
                <VStack space={4}>
                  {recipe.ingredients.map((ing, i) => {
                    const on = !excluded.has(i);
                    const qty = formatQuantity(scaledAmount(i), ing.unit ?? null, scaledAmount(i) == null ? ing.quantity_text : null);
                    return (
                      <Pressable key={i} onPress={() => toggle(i)} className="flex-row items-center rounded-xl bg-card px-3 py-2.5">
                        <Image source={resolveIcon(ing.icon)} contentFit="cover" style={{ width: 34, height: 34, borderRadius: 8 }} />
                        <Text className="ml-3 flex-1 text-base text-ink" numberOfLines={1}>
                          {qty ? <Text className="font-semibold">{qty} </Text> : null}
                          {ing.name}
                        </Text>
                        <Icon
                          name={on ? "checkbox" : "square-outline"}
                          size={22}
                          color={on ? "#A85E2B" : "#B8A88E"}
                        />
                      </Pressable>
                    );
                  })}
                </VStack>
              </ScrollView>

              <Button action="brand" className="mt-4 w-full" onPress={add} disabled={selectedCount === 0}>
                <ButtonText>{selectedCount > 0 ? `Add ${selectedCount} item${selectedCount === 1 ? "" : "s"}` : "Select items"}</ButtonText>
              </Button>
            </View>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}
