import React from "react";
import { View, Modal, ScrollView, TextInput } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { HStack, VStack, Text, Pressable, Button, ButtonText, Icon } from "../ui";
import { Image } from "expo-image";
import { resolveIcon } from "./recipes";
import { parseGroceryLine } from "../../lib/grocery/parse";
import { AISLE_LABELS } from "../../lib/grocery/sort";
import { useCommonIngredients, useAddGroceryItems } from "../../lib/api/hooks";
import type { ApiCommonIngredient } from "../../lib/api/types";

// Live-highlight colours: quantity = amber brand, unit = olive plus, name = ink.
const TOKEN_COLOR = { qty: "#A85E2B", unit: "#5C6350", name: "#2E2419" } as const;

/** Bottom sheet to add items by hand. Parses a Todoist-style line as you type — the
 * highlighted preview shows what's read as quantity/unit vs. the ingredient — and
 * offers matching common ingredients from the catalog. Adds without closing so you
 * can enter several; the scrim/✕ closes. */
export function AddGrocerySheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [text, setText] = React.useState("");
  const { data: catalog } = useCommonIngredients();
  const addItems = useAddGroceryItems();

  const parsed = parseGroceryLine(text);
  const query = parsed.name.trim().toLowerCase();
  const suggestions: ApiCommonIngredient[] = query
    ? (catalog ?? []).filter((c) => c.canonicalName.includes(query)).slice(0, 8)
    : [];

  const reset = () => setText("");

  const addTyped = () => {
    if (!parsed.name) return;
    addItems.mutate([{ name: parsed.name, amount: parsed.amount, unit: parsed.unit }]);
    reset();
  };

  const addCommon = (c: ApiCommonIngredient) => {
    addItems.mutate([{ name: c.canonicalName, amount: 1, unit: c.defaultUnit }]);
    reset();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/30" onPress={onClose}>
        <View className="mt-auto">
          <Pressable onPress={() => {}}>
            <View className="rounded-t-3xl bg-cream px-5 pt-6" style={{ paddingBottom: insets.bottom + 16 }}>
              <View className="mb-4 h-1.5 w-10 self-center rounded-full bg-hairline" />
              <HStack className="mb-3 items-center justify-between">
                <Text className="text-base font-semibold text-ink">Add to Groceries</Text>
                <Pressable onPress={onClose} className="p-1">
                  <Icon name="close" size={22} color="#6E5B48" />
                </Pressable>
              </HStack>

              <TextInput
                value={text}
                onChangeText={setText}
                placeholder="e.g. 2 cups flour"
                placeholderTextColor="#6E5B48"
                autoFocus
                returnKeyType="done"
                onSubmitEditing={addTyped}
                className="rounded-xl border border-hairline bg-card px-4 py-3 text-base text-ink"
              />

              {/* Live parse preview — shows what's read as quantity / unit / name. */}
              {parsed.tokens.length > 0 ? (
                <HStack className="mt-2 flex-wrap items-center px-1" space={6}>
                  <Text className="text-xs text-muted">Reading:</Text>
                  {parsed.tokens.map((t, i) => (
                    <Text key={i} className="text-sm font-semibold" style={{ color: TOKEN_COLOR[t.kind] }}>
                      {t.text}
                    </Text>
                  ))}
                </HStack>
              ) : null}

              {suggestions.length > 0 ? (
                <ScrollView keyboardShouldPersistTaps="handled" className="mt-3 max-h-64">
                  <VStack space={8}>
                    {suggestions.map((c) => (
                      <Pressable
                        key={c.canonicalName}
                        onPress={() => addCommon(c)}
                        className="flex-row items-center rounded-xl bg-card px-3 py-2.5"
                      >
                        <Image source={resolveIcon(c.iconKey)} contentFit="cover" style={{ width: 36, height: 36, borderRadius: 8 }} />
                        <VStack className="ml-3 flex-1">
                          <Text className="text-base capitalize text-ink">{c.canonicalName}</Text>
                          <Text className="text-xs text-muted">{AISLE_LABELS[c.aisle]}</Text>
                        </VStack>
                        <Icon name="add-circle" size={24} color="#A85E2B" />
                      </Pressable>
                    ))}
                  </VStack>
                </ScrollView>
              ) : null}

              <Button action="brand" className="mt-4 w-full" onPress={addTyped} disabled={!parsed.name}>
                <ButtonText>Add</ButtonText>
              </Button>
            </View>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}
