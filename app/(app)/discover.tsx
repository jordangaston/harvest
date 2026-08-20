import React from "react";
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Backdrop } from "../../components/recime/Backdrop";
import { SwipeDeck } from "../../components/swipe/SwipeDeck";
import { useRealDeck } from "../../components/swipe/useRealDeck";
import { usePreferences, useUpdatePreferences } from "../../lib/api/hooks";
import { getRecipeFields } from "../../lib/api/recipes";
import { apiToClient, clientToApi } from "../../lib/api/preferences-map";
import { ScrollView, Pressable, Text } from "../../components/ui";
import { ELEVATION } from "../../lib/elevation";
import type { Preferences } from "../../components/swipe/mock";

/** Meal-type filter chips → the recipe_categories values (any facet) they select. */
const MEAL_FILTERS: { label: string; values: string[] }[] = [
  { label: "Mains", values: ["main_course"] },
  { label: "Breakfast", values: ["breakfast", "brunch"] },
  { label: "Lunch", values: ["lunch"] },
  { label: "Dinner", values: ["dinner"] },
  { label: "Snacks", values: ["snack", "appetizer"] },
  { label: "Salads", values: ["salad"] },
  { label: "Desserts", values: ["dessert", "cookie", "ice_cream", "pie"] },
  { label: "Drinks", values: ["beverage", "cocktail"] },
];

/** Default the filter to the meal slots the user plans (from onboarding weekly_meals). */
function defaultSelection(weeklyMeals?: Record<string, number>): string[] {
  const slots: [string, string][] = [["breakfast", "Breakfast"], ["lunch", "Lunch"], ["dinner", "Dinner"], ["snack", "Snacks"]];
  const sel = slots.filter(([slot]) => (weeklyMeals?.[slot] ?? 0) > 0).map(([, label]) => label);
  return sel.length ? sel : ["Dinner"];
}

/**
 * Discover = the recipe swipe deck. Meal-type chips (defaulted to what the user plans) filter the
 * deck by category; the gear opens the settings modal seeded from — and saved back to — the real
 * preference model. Preferences also supply the "owned equipment" set the accent badge uses.
 */
export default function Discover() {
  const prefs = usePreferences();
  const updatePrefs = useUpdatePreferences();

  // Filter selection defaults to the planned meal slots once preferences load, then the user owns it.
  const [selected, setSelected] = React.useState<string[] | null>(null);
  React.useEffect(() => {
    if (selected === null && prefs.data) setSelected(defaultSelection(prefs.data.weekly_meals as Record<string, number>));
  }, [prefs.data, selected]);
  const active = selected ?? [];
  const categories = React.useMemo(
    () => MEAL_FILTERS.filter((m) => active.includes(m.label)).flatMap((m) => m.values),
    [active],
  );
  const toggle = React.useCallback((label: string) => {
    setSelected((cur) => {
      const s = cur ?? [];
      return s.includes(label) ? s.filter((l) => l !== label) : [...s, label];
    });
  }, []);

  const controller = useRealDeck({
    ownedEquipment: prefs.data?.owned_equipment ?? [],
    allergens: prefs.data?.allergens.map((a) => a.allergen) ?? [],
    diets: prefs.data?.diets.map((d) => d.diet) ?? [],
    categories,
  });
  const settingsInitial = prefs.data ? apiToClient(prefs.data) : undefined;
  const onSaveSettings = React.useCallback((p: Preferences) => updatePrefs.mutate(clientToApi(p)), [updatePrefs]);

  // Lazily fill the DetailSheet's ingredients/steps via the field-projected recipe fetch.
  const hydrateDetail = React.useCallback(async (id: string) => {
    const r = await getRecipeFields(id, ["ingredients", "steps"]);
    return {
      ingredients: (r.ingredients ?? []).map((i) => ({ qty: i.quantity_text ?? [i.amount, i.unit].filter(Boolean).join(" "), name: i.name })),
      steps: r.steps ?? [],
    };
  }, []);

  return (
    <SafeAreaView className="flex-1 bg-cream" edges={["top"]}>
      <Backdrop />
      <MealFilterBar selected={active} onToggle={toggle} />
      <View className="flex-1 justify-center">
        <SwipeDeck controller={controller} settingsInitial={settingsInitial} onSaveSettings={onSaveSettings} hydrateDetail={hydrateDetail} />
      </View>
    </SafeAreaView>
  );
}

/** Horizontal multi-select meal-type chips. Selected = solid brand; unselected = lifted card. */
function MealFilterBar({ selected, onToggle }: { selected: string[]; onToggle: (label: string) => void }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      className="max-h-14 flex-none"
      contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 10, gap: 8 }}
    >
      {MEAL_FILTERS.map((m) => {
        const on = selected.includes(m.label);
        return (
          <Pressable
            key={m.label}
            onPress={() => onToggle(m.label)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            className={`h-9 justify-center rounded-full px-4 ${on ? "bg-brand" : "bg-card"}`}
            style={on ? undefined : ELEVATION.low}
          >
            <Text className={`text-sm font-semibold ${on ? "text-white" : "text-muted"}`}>{m.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
