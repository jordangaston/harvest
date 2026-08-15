import React from "react";
import { Modal, View, ScrollView } from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Box, HStack, VStack, Text, Pressable, Icon, Input, Button, ButtonText, Center } from "../ui";
import { useCommonIngredients } from "../../lib/api/hooks";
import { resolveIcon } from "./recipes";

/**
 * The "Filter by ingredients" sheet: a searchable Popular grid (from Grocery's
 * common-ingredients endpoint, with a hard-coded fallback). Multi-select; a card
 * must contain ALL chosen ingredients (AND). The search box also lets you add a
 * free-text term that isn't in the grid.
 */
export function IngredientFilterSheet({
  visible,
  selected,
  onApply,
  onClose,
}: {
  visible: boolean;
  selected: string[];
  onApply: (ingredients: string[]) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { data: common } = useCommonIngredients();
  const [picked, setPicked] = React.useState<string[]>(selected);
  const [query, setQuery] = React.useState("");

  // Reset to the applied selection each open — the instance is reused across meals.
  React.useEffect(() => {
    if (visible) {
      setPicked(selected);
      setQuery("");
    }
  }, [visible, selected]);

  const toggle = (name: string) =>
    setPicked((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]));

  const q = query.trim().toLowerCase();
  const grid = (common ?? []).filter((c) => !q || c.canonicalName.toLowerCase().includes(q));
  const canAddCustom = q.length > 0 && !grid.some((c) => c.canonicalName.toLowerCase() === q) && !picked.includes(query.trim());

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/30" onPress={onClose}>
        <View className="mt-auto">
          <Pressable onPress={() => {}}>
            <Box className="rounded-t-3xl bg-cream px-5 pt-4" style={{ paddingBottom: insets.bottom + 16, maxHeight: "82%" }}>
              <View className="mb-3 h-1.5 w-10 self-center rounded-full bg-hairline" />
              <HStack className="mb-3 items-center justify-between">
                <Text className="text-lg font-bold text-ink">Filter by ingredients</Text>
                <Pressable onPress={onClose}>
                  <Icon name="close" size={22} color="#6E5B48" />
                </Pressable>
              </HStack>
              <Input placeholder="What's in your pantry?" value={query} onChangeText={setQuery} className="mb-3" />

              {canAddCustom ? (
                <Pressable
                  onPress={() => {
                    toggle(query.trim());
                    setQuery("");
                  }}
                  className="mb-2 flex-row items-center rounded-2xl border border-brand bg-brand-light px-4 py-3"
                >
                  <Icon name="add-circle" size={20} color="#A85E2B" />
                  <Text className="ml-2 font-semibold text-ink">Add “{query.trim()}”</Text>
                </Pressable>
              ) : null}

              <ScrollView style={{ maxHeight: 360 }} showsVerticalScrollIndicator={false}>
                <View className="flex-row flex-wrap justify-between">
                  {grid.map((c) => {
                    const on = picked.includes(c.canonicalName);
                    return (
                      <Pressable
                        key={c.canonicalName}
                        onPress={() => toggle(c.canonicalName)}
                        className="mb-3 items-center"
                        style={{ width: "22%" }}
                      >
                        <View className={`rounded-2xl border ${on ? "border-brand" : "border-hairline"}`}>
                          <Image source={resolveIcon(c.iconKey)} contentFit="cover" style={{ width: 56, height: 56, borderRadius: 14, opacity: on ? 1 : 0.9 }} />
                          {on ? (
                            <Center className="absolute right-0 top-0 h-5 w-5 rounded-full bg-brand" style={{ transform: [{ translateX: 4 }, { translateY: -4 }] }}>
                              <Icon name="checkmark" size={12} color="#fff" />
                            </Center>
                          ) : null}
                        </View>
                        <Text className="mt-1 text-center text-xs text-ink" numberOfLines={1}>{c.canonicalName}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </ScrollView>

              <HStack className="mt-3" space={12}>
                <Button action="light" className="flex-1" onPress={() => onApply([])}>
                  <ButtonText className="text-ink">Clear</ButtonText>
                </Button>
                <Button className="flex-1" onPress={() => onApply(picked)}>
                  <ButtonText>Apply{picked.length ? ` (${picked.length})` : ""}</ButtonText>
                </Button>
              </HStack>
            </Box>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}
