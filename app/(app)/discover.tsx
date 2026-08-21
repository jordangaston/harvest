import React from "react";
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Backdrop } from "../../components/recime/Backdrop";
import { SwipeDeck } from "../../components/swipe/SwipeDeck";
import { useRealDeck } from "../../components/swipe/useRealDeck";
import { usePreferences, useUpdatePreferences } from "../../lib/api/hooks";
import { getRecipeFields } from "../../lib/api/recipes";
import { apiToClient, clientToApi } from "../../lib/api/preferences-map";
import { defaultMealSelection, categoriesForSelection } from "../../components/swipe/mealFilters";
import type { Preferences } from "../../components/swipe/mock";

/**
 * Discover = the recipe swipe deck. The meal-type filter (defaulted to what the user plans) lives
 * in the deck's settings sheet, alongside the ranking preferences seeded from — and saved back to —
 * the real preference model. Preferences also supply the "owned equipment" set the accent badge uses.
 */
export default function Discover() {
  const prefs = usePreferences();
  const updatePrefs = useUpdatePreferences();

  // Filter selection defaults to the planned meal slots once preferences load, then the user owns it.
  const [selected, setSelected] = React.useState<string[] | null>(null);
  React.useEffect(() => {
    if (selected === null && prefs.data) setSelected(defaultMealSelection(prefs.data.weekly_meals as Record<string, number>));
  }, [prefs.data, selected]);
  const active = selected ?? [];
  const categories = React.useMemo(() => categoriesForSelection(active), [active]);
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
      <View className="flex-1 justify-center">
        <SwipeDeck
          controller={controller}
          settingsInitial={settingsInitial}
          onSaveSettings={onSaveSettings}
          hydrateDetail={hydrateDetail}
          mealFilter={{ selected: active, onToggle: toggle }}
        />
      </View>
    </SafeAreaView>
  );
}
