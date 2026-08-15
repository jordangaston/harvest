import React from "react";
import { View, Modal, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import { Backdrop } from "../../components/recime/Backdrop";
import { VStack, HStack, Center, Text, Heading, Pressable, Button, Icon } from "../../components/ui";
import { Image as UiImage } from "../../components/ui";
import { AddGrocerySheet } from "../../components/recime/AddGrocerySheet";
import { resolveIcon } from "../../components/recime/recipes";
import { useGroceries, usePatchGroceryItem, useDeleteGroceryItem } from "../../lib/api/hooks";
import { groupAndSort, type SortMode } from "../../lib/grocery/sort";
import { formatQuantity } from "../../lib/grocery/scale";
import type { ApiGroceryItem } from "../../lib/api/types";

const SORTS: { mode: SortMode; label: string }[] = [
  { mode: "aisle", label: "Aisle" },
  { mode: "recipe", label: "Recipe" },
  { mode: "az", label: "A–Z" },
];

export default function Groceries() {
  const { data: items } = useGroceries();
  const patch = usePatchGroceryItem();
  const del = useDeleteGroceryItem();
  const [sort, setSort] = React.useState<SortMode>("aisle");
  const [sortOpen, setSortOpen] = React.useState(false);
  const [addOpen, setAddOpen] = React.useState(false);
  const [storeOpen, setStoreOpen] = React.useState(false);
  const [store, setStore] = React.useState<"instacart" | "walmart" | null>(null);

  const list = items ?? [];
  const sections = groupAndSort(list, sort);
  const sortLabel = SORTS.find((s) => s.mode === sort)!.label;

  const toggle = (item: ApiGroceryItem) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    patch.mutate({ id: item.id, checked: !item.checked });
  };
  const remove = (item: ApiGroceryItem) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    del.mutate(item.id);
  };

  return (
    <SafeAreaView className="flex-1 bg-cream" edges={["top"]}>
      <Backdrop />
      <HStack className="items-end justify-between px-5 pt-2">
        <VStack>
          <Heading className="text-2xl">Grocery List</Heading>
          <Text className="text-muted">{list.length} item{list.length === 1 ? "" : "s"}</Text>
        </VStack>
        {list.length > 0 ? (
          <Pressable onPress={() => setSortOpen(true)} className="flex-row items-center rounded-full bg-card px-3 py-2">
            <Icon name="swap-vertical" size={16} color="#2E2419" />
            <Text className="ml-1.5 text-sm font-semibold text-ink">{sortLabel}</Text>
            <Icon name="chevron-down" size={14} color="#6E5B48" />
          </Pressable>
        ) : null}
      </HStack>

      <View className="px-5 pt-4">
        <Button action="light" variant="outline" onPress={() => setStoreOpen(true)}>
          <Text className="mr-2 text-base">🛒</Text>
          <Text className="text-base font-semibold text-ink">Order online</Text>
        </Button>
      </View>

      {list.length === 0 ? (
        <Center className="flex-1 px-6">
          <UiImage source={require("../../assets/empty-groceries.png")} resizeMode="contain" className="mb-4 h-64 w-64" />
          <Text className="text-muted">No ingredients added</Text>
        </Center>
      ) : (
        <ScrollView className="flex-1 px-5 pt-3" contentContainerStyle={{ paddingBottom: 120 }}>
          {sections.map((section) => (
            <VStack key={section.key} className="mb-4" space={2}>
              {section.title ? (
                <Text className="mb-1 text-xs font-bold tracking-wide text-brand-dark">{section.title}</Text>
              ) : null}
              {section.items.map((item) => {
                const qty = formatQuantity(item.amount, item.unit, item.quantity_text);
                return (
                  <Pressable
                    key={item.id}
                    onPress={() => toggle(item)}
                    onLongPress={() => remove(item)}
                    className="flex-row items-center rounded-xl bg-card px-3 py-2.5"
                    style={{ opacity: item.checked ? 0.55 : 1 }}
                  >
                    <Image source={resolveIcon(item.icon)} contentFit="cover" style={{ width: 34, height: 34, borderRadius: 8 }} />
                    <Text
                      className="ml-3 flex-1 text-base text-ink"
                      numberOfLines={1}
                      style={item.checked ? { textDecorationLine: "line-through" } : undefined}
                    >
                      {item.name}
                      {qty ? <Text className="text-muted"> · {qty}</Text> : null}
                    </Text>
                    <Icon
                      name={item.checked ? "checkbox" : "square-outline"}
                      size={22}
                      color={item.checked ? "#A85E2B" : "#B8A88E"}
                    />
                  </Pressable>
                );
              })}
            </VStack>
          ))}
          <Text className="mb-2 text-center text-xs text-muted">Long-press an item to remove it</Text>
        </ScrollView>
      )}

      <Pressable
        className="absolute bottom-6 right-6 h-14 w-14 items-center justify-center rounded-full bg-brand shadow-lg"
        onPress={() => setAddOpen(true)}
      >
        <Icon name="add" size={30} color="#fff" />
      </Pressable>

      <AddGrocerySheet visible={addOpen} onClose={() => setAddOpen(false)} />

      {/* Sort menu */}
      <Modal visible={sortOpen} transparent animationType="slide" onRequestClose={() => setSortOpen(false)}>
        <Pressable className="flex-1 bg-black/30" onPress={() => setSortOpen(false)}>
          <View className="mt-auto">
            <View className="rounded-t-3xl bg-cream px-5 pb-10 pt-6">
              <Text className="mb-3 text-center text-base font-semibold text-ink">Sort by</Text>
              {SORTS.map((s) => (
                <Pressable
                  key={s.mode}
                  onPress={() => { setSort(s.mode); setSortOpen(false); }}
                  className="flex-row items-center justify-between rounded-xl bg-card px-4 py-3.5 mb-2"
                >
                  <Text className="text-base font-semibold text-ink">{s.label}</Text>
                  {sort === s.mode ? <Icon name="checkmark-circle" size={22} color="#A85E2B" /> : null}
                </Pressable>
              ))}
            </View>
          </View>
        </Pressable>
      </Modal>

      {/* Order-online stub (Wave 3) */}
      <Modal visible={storeOpen} transparent animationType="slide" onRequestClose={() => setStoreOpen(false)}>
        <Pressable className="flex-1 bg-black/30" onPress={() => setStoreOpen(false)}>
          <View className="mt-auto">
            <View className="rounded-t-3xl bg-cream px-5 pb-10 pt-6">
              <Text className="mb-1 text-center text-base font-semibold text-ink">Choose store</Text>
              <Text className="mb-4 text-center text-xs text-muted">Online ordering is coming soon</Text>
              {(["instacart", "walmart"] as const).map((s) => (
                <Pressable
                  key={s}
                  className="flex-row items-center justify-between rounded-xl bg-card px-4 py-4 mb-2"
                  onPress={() => setStore(s)}
                >
                  <Text className="text-base font-semibold capitalize text-ink">{s}</Text>
                  {store === s ? <Icon name="checkmark-circle" size={22} color="#A85E2B" /> : null}
                </Pressable>
              ))}
            </View>
          </View>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}
