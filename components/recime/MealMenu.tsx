import React from "react";
import { Modal, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Box, HStack, VStack, Text, Pressable, Icon, Center } from "../ui";
import { MEALS } from "./meals";
import type { MealSlot } from "../../lib/api/types";

/**
 * The small "pick a meal" sheet (Breakfast/Lunch/Dinner/Snack). Slides up over a
 * scrim like every other sheet; picking a meal calls `onPick` and closes.
 */
export function MealMenu({
  visible,
  title = "Add to meal plan",
  onPick,
  onClose,
}: {
  visible: boolean;
  title?: string;
  onPick: (meal: MealSlot) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/30" onPress={onClose}>
        <View className="mt-auto">
          <Pressable onPress={() => {}}>
            <Box className="rounded-t-3xl bg-cream px-5 pt-4" style={{ paddingBottom: insets.bottom + 16 }}>
              <View className="mb-3 h-1.5 w-10 self-center rounded-full bg-hairline" />
              <Text className="mb-2 text-center text-base font-bold text-ink">{title}</Text>
              <VStack space={8}>
                {MEALS.map((m) => (
                  <Pressable
                    key={m.key}
                    onPress={() => onPick(m.key)}
                    className="flex-row items-center rounded-2xl border border-hairline bg-card px-4 py-3.5"
                  >
                    <Center className={`mr-3 h-9 w-9 rounded-full ${m.chip}`}>
                      <Icon name={m.icon} size={20} color="#2E2419" />
                    </Center>
                    <Text className="text-base font-semibold text-ink">{m.label}</Text>
                  </Pressable>
                ))}
              </VStack>
              <HStack className="mt-2 justify-center">
                <Pressable onPress={onClose} className="py-3">
                  <Text className="font-semibold text-brand-dark">Cancel</Text>
                </Pressable>
              </HStack>
            </Box>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}
