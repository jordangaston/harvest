import React from "react";
import { Modal, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Box, HStack, VStack, Text, Pressable, Icon, Center } from "../ui";
import { MealMenu } from "./MealMenu";
import { useAddMealPlanEntry } from "../../lib/api/hooks";
import { mealLabel } from "./meals";
import { mondayOf, weekDates, addDays, toISO, todayISO, formatWeekRange, weekdayName } from "../../lib/week";
import type { MealSlot } from "../../lib/api/types";

/**
 * The recipe-screen "Add to meal plan" sheet: the recipe is pre-chosen, so the user
 * picks a day (paging weeks with ‹ ›) then a meal. Same POST as the day flow.
 */
export function AddToPlanSheet({
  visible,
  recipeId,
  onAdded,
  onClose,
}: {
  visible: boolean;
  recipeId: string;
  onAdded: (meal: MealSlot, dayLabel: string) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const add = useAddMealPlanEntry();
  const [monday, setMonday] = React.useState(() => mondayOf(new Date()));
  const [chosen, setChosen] = React.useState<Date | null>(null);

  // Reset to this week with no day chosen each open — the instance is reused.
  React.useEffect(() => {
    if (visible) {
      setMonday(mondayOf(new Date()));
      setChosen(null);
    }
  }, [visible]);

  const today = todayISO();
  const days = weekDates(monday);

  const pickMeal = async (meal: MealSlot) => {
    if (!chosen || add.isPending) return;
    try {
      await add.mutateAsync({ date: toISO(chosen), meal, recipeId });
      onAdded(meal, `${weekdayName(chosen)} ${chosen.getDate()}`);
    } catch {
      // keep open to retry
    } finally {
      setChosen(null);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/30" onPress={onClose}>
        <View className="mt-auto">
          <Pressable onPress={() => {}}>
            <Box className="rounded-t-3xl bg-cream px-5 pt-4" style={{ paddingBottom: insets.bottom + 16 }}>
              <View className="mb-3 h-1.5 w-10 self-center rounded-full bg-hairline" />
              <HStack className="mb-3 items-center justify-between">
                <Text className="text-lg font-bold text-ink">Add to meal plan</Text>
                <Pressable onPress={onClose}>
                  <Icon name="close" size={22} color="#6E5B48" />
                </Pressable>
              </HStack>

              <HStack className="mb-3 items-center justify-between">
                <Pressable onPress={() => setMonday(addDays(monday, -7))} className="p-1">
                  <Icon name="chevron-back" size={22} color="#2E2419" />
                </Pressable>
                <Text className="text-sm font-semibold text-ink">{formatWeekRange(monday)}</Text>
                <Pressable onPress={() => setMonday(addDays(monday, 7))} className="p-1">
                  <Icon name="chevron-forward" size={22} color="#2E2419" />
                </Pressable>
              </HStack>

              <VStack space={6}>
                {days.map((d) => {
                  const isToday = toISO(d) === today;
                  return (
                    <Pressable
                      key={toISO(d)}
                      onPress={() => setChosen(d)}
                      className="flex-row items-center justify-between rounded-2xl border border-hairline bg-card px-4 py-3"
                    >
                      <Text className={`text-base font-semibold ${isToday ? "text-brand" : "text-ink"}`}>
                        {isToday ? "Today • " : ""}{weekdayName(d)} {d.getDate()}
                      </Text>
                      <Center className="h-7 w-7 rounded-full bg-brand-light">
                        <Icon name="add" size={18} color="#A85E2B" />
                      </Center>
                    </Pressable>
                  );
                })}
              </VStack>
            </Box>
          </Pressable>
        </View>
      </Pressable>

      <MealMenu
        visible={chosen !== null}
        title={chosen ? `Add to ${weekdayName(chosen)} ${chosen.getDate()}` : "Add to meal plan"}
        onPick={pickMeal}
        onClose={() => setChosen(null)}
      />
    </Modal>
  );
}
