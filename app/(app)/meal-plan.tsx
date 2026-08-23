import React from "react";
import { View } from "react-native";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Backdrop } from "../../components/recime/Backdrop";
import { VStack, HStack, Center, ScrollView, Text, Heading, Pressable, Icon } from "../../components/ui";
import { MealMenu } from "../../components/recime/MealMenu";
import { MealAddRecipeSheet } from "../../components/recime/MealAddRecipeSheet";
import { Toast, useToast } from "../../components/recime/Toast";
import { mealChip, mealLabel } from "../../components/recime/meals";
import { useMealPlanWeek, useRemoveMealPlanEntry } from "../../lib/api/hooks";
import { mondayOf, addDays, weekDates, toISO, todayISO, formatWeekRange, weekdayName } from "../../lib/week";
import type { ApiMealPlanEntry, MealSlot } from "../../lib/api/types";
import { ELEVATION } from "../../lib/elevation";

export default function MealPlan() {
  const router = useRouter();
  const [monday, setMonday] = React.useState(() => mondayOf(new Date()));
  const weekStart = toISO(monday);
  const weekEnd = toISO(addDays(monday, 6));

  const { data: entries } = useMealPlanWeek(weekStart, weekEnd);
  const remove = useRemoveMealPlanEntry(weekStart);

  const [menuDate, setMenuDate] = React.useState<string | null>(null); // day whose MealMenu is open
  const [addSlot, setAddSlot] = React.useState<{ date: string; meal: MealSlot } | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);

  const today = todayISO();
  const days = weekDates(monday);
  const byDay = groupByDay(entries ?? []);

  const showToast = useToast(setToast);

  const onPickMeal = (meal: MealSlot) => {
    if (!menuDate) return;
    const date = menuDate;
    setMenuDate(null);
    setAddSlot({ date, meal });
  };

  return (
    <SafeAreaView className="flex-1 bg-cream" edges={["top"]}>
      <Backdrop />
      <HStack className="items-center justify-between px-5 pt-2">
        <Heading className="text-2xl">My Meal Plan</Heading>
        {/* Week-level secondary actions. Kept low-emphasis (muted icons on a receding sand tile,
            no border/elevation) so the brand FAB stays the one primary action — Refactoring UI
            Ch2 "emphasise by de-emphasising", Ch8 "get rid of borders". */}
        <HStack className="items-center" space={10}>
          <SecondaryAction label="Add this week to groceries" onPress={() => showToast("Groceries coming soon")}>
            <CartPlusIcon />
          </SecondaryAction>
          <SecondaryAction label="Regenerate this week" onPress={() => showToast("Regenerate coming soon")}>
            <Icon name="refresh" size={20} color={SECONDARY_ICON} />
          </SecondaryAction>
        </HStack>
      </HStack>

      <HStack className="items-center justify-between px-5 py-4">
        <Pressable onPress={() => setMonday(addDays(monday, -7))} className="p-1">
          <Icon name="chevron-back" size={22} color="#2E2419" />
        </Pressable>
        <Text className="text-base font-semibold text-ink">{formatWeekRange(monday)}</Text>
        <Pressable onPress={() => setMonday(addDays(monday, 7))} className="p-1">
          <Icon name="chevron-forward" size={22} color="#2E2419" />
        </Pressable>
      </HStack>

      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 32 }}>
        {days.map((d) => {
          const iso = toISO(d);
          const dayEntries = byDay.get(iso) ?? [];
          const isToday = iso === today;
          return (
            <View key={iso}>
              <HStack className="items-center justify-between px-5 pt-5">
                <Text className={`text-base font-bold ${isToday ? "text-brand" : "text-ink"}`}>
                  {isToday ? "Today • " : ""}{weekdayName(d)} {d.getDate()}
                </Text>
                {/* The primary per-day action — solid brand so "add a meal" is the one thing that
                    stands out on each row (Refactoring UI Ch2: style the primary action highest-emphasis;
                    colour = the primary action, Ch5). Replaces the removed floating button. */}
                <Pressable
                  onPress={() => setMenuDate(iso)}
                  accessibilityRole="button"
                  accessibilityLabel={`Add a meal to ${weekdayName(d)} ${d.getDate()}`}
                  className="h-9 w-9 items-center justify-center rounded-full bg-brand"
                  style={ELEVATION.low}
                >
                  <Icon name="add" size={20} color="#fff" />
                </Pressable>
              </HStack>
              {dayEntries.length === 0 ? (
                <Text className="px-5 pb-3 pt-1.5 text-muted">No recipes yet</Text>
              ) : (
                <VStack className="px-5 pt-2" space={8}>
                  {dayEntries.map((e) => (
                    <EntryRow key={e.id} entry={e} onOpen={() => router.push(`/recipe/${e.recipe.id}`)} onRemove={() => remove.mutate(e.id)} />
                  ))}
                </VStack>
              )}
              <View className="mx-5 mt-4 h-px bg-hairline" />
            </View>
          );
        })}
      </ScrollView>

      <MealMenu
        visible={menuDate !== null}
        title="Add a meal"
        onPick={onPickMeal}
        onClose={() => setMenuDate(null)}
      />
      {addSlot ? (
        <MealAddRecipeSheet
          visible={addSlot !== null}
          date={addSlot.date}
          meal={addSlot.meal}
          onAdded={(meal) => {
            setAddSlot(null);
            showToast(`Added to ${mealLabel(meal)}`);
          }}
          onClose={() => setAddSlot(null)}
        />
      ) : null}

      {toast ? <Toast message={toast} /> : null}
    </SafeAreaView>
  );
}

function EntryRow({ entry, onOpen, onRemove }: { entry: ApiMealPlanEntry; onOpen: () => void; onRemove: () => void }) {
  return (
    <HStack className="items-center rounded-2xl border border-hairline bg-card p-2.5" space={0} style={ELEVATION.low}>
      <Pressable onPress={onOpen} className="flex-1 flex-row items-center">
        {entry.recipe.image_url ? (
          <Image source={{ uri: entry.recipe.image_url }} contentFit="cover" style={{ width: 52, height: 52, borderRadius: 12 }} />
        ) : (
          <Center className="h-[52px] w-[52px] rounded-xl bg-brand-light">
            <Icon name="restaurant-outline" size={20} color="#A85E2B" />
          </Center>
        )}
        <VStack className="ml-3 flex-1" space={4}>
          <Text className="text-base font-semibold text-ink" numberOfLines={2}>{entry.recipe.title}</Text>
          <View className={`self-start rounded-md px-2 py-0.5 ${mealChip(entry.meal)}`}>
            <Text className="text-xs font-semibold text-ink">{mealLabel(entry.meal)}</Text>
          </View>
        </VStack>
      </Pressable>
      <Pressable onPress={onRemove} hitSlop={8} className="ml-2 p-1.5">
        <Icon name="close-circle" size={22} color="#6E5B48" />
      </Pressable>
    </HStack>
  );
}

/** Muted ink for the secondary header actions — they recede so the brand FAB reads as primary. */
const SECONDARY_ICON = "#6E5B48";

/** A low-emphasis header action: a muted icon on a receding sand tile, no border or shadow
 * (Refactoring UI Ch2 de-emphasise, Ch8 fewer borders). Icon-only, so it carries its own label. */
function SecondaryAction({ label, onPress, children }: { label: string; onPress: () => void; children: React.ReactNode }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      className="h-10 w-10 items-center justify-center rounded-full bg-sand-200"
    >
      {children}
    </Pressable>
  );
}

/** A shopping cart with a small brand "+" badge — "add this week to groceries". Ionicons has no
 * cart-add glyph, so we compose one; the badge is the only spot of colour (add = brand, Ch5). */
function CartPlusIcon() {
  return (
    <View className="relative">
      <Icon name="cart-outline" size={20} color={SECONDARY_ICON} />
      <Center className="absolute -right-2 -top-2 h-4 w-4 rounded-full bg-brand">
        <Icon name="add" size={12} color="#fff" />
      </Center>
    </View>
  );
}

/** Groups entries by their date (they arrive already ordered by date/meal/position). */
function groupByDay(entries: ApiMealPlanEntry[]): Map<string, ApiMealPlanEntry[]> {
  const map = new Map<string, ApiMealPlanEntry[]>();
  for (const e of entries) {
    const list = map.get(e.date) ?? [];
    list.push(e);
    map.set(e.date, list);
  }
  return map;
}
