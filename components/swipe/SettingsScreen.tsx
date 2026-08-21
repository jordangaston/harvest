import React from "react";
import { Modal, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ScrollView, VStack, HStack, Text, Pressable, Icon } from "../ui";
import { analytics } from "../../lib/analytics";
import { MealCounts } from "../planner/MealPlanIntake";
import {
  Chip, Segmented, Slider, MoreChip, SearchAddSheet, Card,
  CUISINES, ALL_CUISINES, ALL_INGREDIENTS, ALLERGENS, DIETS, EQUIPMENT, ALL_EQUIPMENT,
  EQUIP_TYPE_TO_LABEL, EQUIP_LABEL_TO_TYPE, tasteFacet,
} from "../onboarding/primitives";
import {
  Preferences, DEFAULT_PREFERENCES, COMMON_INGREDIENTS, money, formatTime, DifficultyBand, MealType,
} from "./mock";
import { MEAL_FILTERS } from "./mealFilters";

/**
 * The preferences surface — declarative, not explanatory: the user sets what they want;
 * the copy doesn't teach how the ranking uses it (per Jordan's review). Cards are grouped
 * by kind (allergies / diet / kitchen, then tastes) with spacing, not headers. Operable
 * controls hold local draft state (no live re-rank in the prototype; see docs/swipe-ui/DESIGN.md).
 *
 * Its building blocks (Chip, Segmented, Slider, …) and option corpora live in
 * components/onboarding/primitives.tsx so onboarding and Settings share one source of truth.
 */
export function SettingsContent({ onClose, embedded = false, initial = DEFAULT_PREFERENCES, onSave, mealFilter }: { onClose: () => void; embedded?: boolean; initial?: Preferences; onSave?: (p: Preferences) => void; mealFilter?: { selected: string[]; onToggle: (label: string) => void } }) {
  const [p, setP] = React.useState<Preferences>(initial);
  const [cuisineSearch, setCuisineSearch] = React.useState(false);
  const [ingredientSearch, setIngredientSearch] = React.useState(false);
  const [equipmentSearch, setEquipmentSearch] = React.useState(false);
  // Preset chips plus anything the user added via search, so added options stay visible.
  const likeValues = p.likes.map((t) => t.value);
  const dislikeValues = p.dislikes.map((t) => t.value);
  const cuisineChips = Array.from(new Set([...CUISINES, ...likeValues]));
  const ingredientChips = Array.from(new Set([...COMMON_INGREDIENTS, ...dislikeValues]));
  const equipmentChips = Array.from(new Set([...EQUIPMENT.map((e) => e.type), ...p.ownedEquipment]));

  const track = (control: string, from: unknown, to: unknown, kind: "soft" | "hard") =>
    analytics.track("Settings Preference Changed", { control, from, to, kind });

  const setMeal = (m: MealType, v: number) => {
    track(`meals.${m}`, p.weeklyMeals[m], v, "soft");
    setP((s) => ({ ...s, weeklyMeals: { ...s.weeklyMeals, [m]: v } }));
  };
  const toggleEquipment = (item: string) => {
    setP((s) => {
      const has = s.ownedEquipment.includes(item);
      track("ownedEquipment", has ? "on" : "off", has ? "off" : "on", "hard");
      return { ...s, ownedEquipment: has ? s.ownedEquipment.filter((x) => x !== item) : [...s.ownedEquipment, item] };
    });
  };
  // Likes/dislikes hold {facet,value}; toggle by value and tag the facet from the label's corpus.
  const toggleTaste = (key: "likes" | "dislikes", value: string) => {
    setP((s) => {
      const has = s[key].some((t) => t.value === value);
      track(key, has ? "on" : "off", has ? "off" : "on", "soft");
      return { ...s, [key]: has ? s[key].filter((t) => t.value !== value) : [...s[key], { facet: tasteFacet(value), value }] };
    });
  };

  const body = (
    <>
              {/* Deck filter: which meal types to show. Applies live (independent of Save). */}
              {mealFilter ? (
                <Card>
                  <Text className="text-sm font-bold text-ink">Meal types</Text>
                  <View className="flex-row flex-wrap" style={{ gap: 8, marginTop: 8 }}>
                    {MEAL_FILTERS.map((m) => (
                      <Chip key={m.label} label={m.label} active={mealFilter.selected.includes(m.label)} onToggle={() => mealFilter.onToggle(m.label)} />
                    ))}
                  </View>
                </Card>
              ) : null}

              {/* Most-likely-to-change first, each its own card. */}
              <VStack space={14}>
                <MealCounts value={p.weeklyMeals} onChange={setMeal} />
                <Card>
                  <Text className="text-sm font-bold text-ink">Weekly grocery budget</Text>
                  <Slider value={p.weeklyBudgetCents} min={3000} max={40000} step={1000} format={(c) => `${money(c)} / week`} onChange={(v) => setP((s) => ({ ...s, weeklyBudgetCents: v }))} />
                </Card>
                <Card>
                  <Text className="text-sm font-bold text-ink">Time per meal</Text>
                  {([["breakfast", "Breakfast"], ["lunch", "Lunch"], ["dinner", "Dinner"]] as const).map(([key, label]) => (
                    <VStack key={key} space={4}>
                      <HStack className="items-center justify-between">
                        <Text className="text-base text-ink">{label}</Text>
                        <Text className="text-base font-bold text-brand">{formatTime(p.timeByMeal[key])}</Text>
                      </HStack>
                      <Slider value={p.timeByMeal[key]} min={10} max={120} step={5} hideValue format={(m) => formatTime(m)} onChange={(v) => setP((s) => ({ ...s, timeByMeal: { ...s.timeByMeal, [key]: v } }))} />
                    </VStack>
                  ))}
                </Card>
                <Card>
                  <Text className="text-sm font-bold text-ink">Your skill level</Text>
                  <Segmented label="Skill level" value={p.skillLevel} onChange={(v) => { track("skillLevel", p.skillLevel, v, "soft"); setP((s) => ({ ...s, skillLevel: v as DifficultyBand })); }} options={[{ label: "Beginner", value: "beginner" }, { label: "Intermediate", value: "intermediate" }, { label: "Advanced", value: "advanced" }]} />
                </Card>
              </VStack>

              {/* Filters */}
              <VStack space={14}>
                <Card>
                  <Text className="text-sm font-bold text-ink">Allergies</Text>
                  {p.allergens.map((a) => (
                    <VStack key={a.allergen} space={8}>
                      <HStack className="items-center justify-between">
                        <Text className="text-base capitalize text-ink">{a.allergen}</Text>
                        <Pressable onPress={() => setP((s) => ({ ...s, allergens: s.allergens.filter((x) => x.allergen !== a.allergen) }))} accessibilityLabel={`Remove ${a.allergen}`}><Icon name="trash-outline" size={18} color="#6E5B48" /></Pressable>
                      </HStack>
                      <Segmented
                        label={`${a.allergen} severity`}
                        value={a.severity}
                        onChange={(sev) => { track(`allergen.${a.allergen}`, a.severity, sev, "hard"); setP((s) => ({ ...s, allergens: s.allergens.map((x) => x.allergen === a.allergen ? { ...x, severity: sev } : x) })); }}
                        options={[{ label: "Mild", value: "mild" }, { label: "Moderate", value: "moderate" }, { label: "Severe", value: "severe" }]}
                      />
                    </VStack>
                  ))}
                  <View className="flex-row flex-wrap" style={{ gap: 8, marginTop: 8 }}>
                    {ALLERGENS.filter((a) => !p.allergens.some((x) => x.allergen === a)).map((a) => (
                      <Chip key={a} label={`+ ${a}`} active={false} onToggle={() => { track(`allergen.${a}`, "off", "moderate", "hard"); setP((s) => ({ ...s, allergens: [...s.allergens, { allergen: a, severity: "moderate" }] })); }} />
                    ))}
                  </View>
                </Card>

                <Card>
                  <Text className="text-sm font-bold text-ink">Diet</Text>
                  {p.diets.map((d) => (
                    <VStack key={d.diet} space={8}>
                      <HStack className="items-center justify-between">
                        <Text className="text-base text-ink">{d.diet}</Text>
                        <HStack className="items-center" space={10}>
                          <View style={{ width: 170 }}>
                            <Segmented
                              label={`${d.diet} strictness`}
                              value={d.strictness}
                              onChange={(st) => { track(`diet.${d.diet}`, d.strictness, st, "hard"); setP((s) => ({ ...s, diets: s.diets.map((x) => x.diet === d.diet ? { ...x, strictness: st } : x) })); }}
                              options={[{ label: "Flexible", value: "flexible" }, { label: "Strict", value: "strict" }]}
                            />
                          </View>
                          <Pressable onPress={() => setP((s) => ({ ...s, diets: s.diets.filter((x) => x.diet !== d.diet) }))} accessibilityLabel={`Remove ${d.diet}`}><Icon name="trash-outline" size={18} color="#6E5B48" /></Pressable>
                        </HStack>
                      </HStack>
                    </VStack>
                  ))}
                  <View className="flex-row flex-wrap" style={{ gap: 8, marginTop: 8 }}>
                    {DIETS.filter((dt) => !p.diets.some((x) => x.diet === dt)).map((dt) => (
                      <Chip key={dt} label={`+ ${dt}`} active={false} onToggle={() => { track(`diet.${dt}`, "off", "flexible", "hard"); setP((s) => ({ ...s, diets: [...s.diets, { diet: dt, strictness: "flexible" }] })); }} />
                    ))}
                  </View>
                </Card>

                <Card>
                  <Text className="text-sm font-bold text-ink">My kitchen</Text>
                  <View className="flex-row flex-wrap" style={{ gap: 8, marginTop: 8 }}>
                    {equipmentChips.map((t) => <Chip key={t} label={EQUIP_TYPE_TO_LABEL[t] ?? t} active={p.ownedEquipment.includes(t)} onToggle={() => toggleEquipment(t)} />)}
                    <MoreChip onPress={() => setEquipmentSearch(true)} />
                  </View>
                </Card>
              </VStack>

              <VStack space={14}>
                <Card>
                  <Text className="text-sm font-bold text-ink">Cuisines you like</Text>
                  <View className="flex-row flex-wrap" style={{ gap: 8 }}>
                    {cuisineChips.map((c) => <Chip key={c} label={c} active={likeValues.includes(c)} onToggle={() => toggleTaste("likes", c)} />)}
                    <MoreChip onPress={() => setCuisineSearch(true)} />
                  </View>
                </Card>

                <Card>
                  <Text className="text-sm font-bold text-ink">Ingredients to avoid</Text>
                  <View className="flex-row flex-wrap" style={{ gap: 8 }}>
                    {ingredientChips.map((i) => <Chip key={i} label={i} active={dislikeValues.includes(i)} onToggle={() => toggleTaste("dislikes", i)} />)}
                    <MoreChip onPress={() => setIngredientSearch(true)} />
                  </View>
                </Card>
              </VStack>

              <Pressable onPress={() => { onSave?.(p); onClose(); }} accessibilityRole="button" accessibilityLabel="Save preferences" className="items-center rounded-full bg-brand py-3.5">
                <Text className="text-base font-bold text-white">Save</Text>
              </Pressable>

              <SearchAddSheet visible={cuisineSearch} title="Add a cuisine" corpus={ALL_CUISINES} selected={likeValues} onToggle={(c) => toggleTaste("likes", c)} onClose={() => setCuisineSearch(false)} />
              <SearchAddSheet visible={ingredientSearch} title="Add an ingredient to avoid" corpus={ALL_INGREDIENTS} selected={dislikeValues} onToggle={(i) => toggleTaste("dislikes", i)} onClose={() => setIngredientSearch(false)} />
              <SearchAddSheet visible={equipmentSearch} title="Add kitchen equipment" corpus={ALL_EQUIPMENT.map((e) => e.label)} selected={p.ownedEquipment.map((t) => EQUIP_TYPE_TO_LABEL[t]).filter(Boolean)} onToggle={(label) => toggleEquipment(EQUIP_LABEL_TO_TYPE[label])} onClose={() => setEquipmentSearch(false)} />
    </>
  );

  // Flat layout (studio preview) — no inner scroll, so the studio's outer ScrollView moves the
  // content AND its comment pins together; a pin anchored to a scrolling viewport would drift.
  if (embedded) {
    return <View style={{ padding: 20 }}><VStack space={28}>{body}</VStack></View>;
  }

  return (
    <SafeAreaView edges={["bottom"]} style={{ flex: 1 }}>
      <HStack className="items-center justify-between px-5 pb-2 pt-4">
        <Text className="text-xl text-ink" style={{ fontFamily: "Karla_700Bold" }}>Your preferences</Text>
        <Pressable onPress={onClose} accessibilityLabel="Close preferences" className="rounded-full bg-card p-2"><Icon name="close" size={20} color="#2E2419" /></Pressable>
      </HStack>
      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 8, gap: 28 }}>
        {body}
      </ScrollView>
    </SafeAreaView>
  );
}

/** The deck's gear opens this — the settings content in a bottom-sheet Modal. */
export function SettingsScreen({ visible, onClose, initial, onSave, mealFilter }: { visible: boolean; onClose: () => void; initial?: Preferences; onSave?: (p: Preferences) => void; mealFilter?: { selected: string[]; onToggle: (label: string) => void } }) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View className="flex-1 justify-end" style={{ backgroundColor: "rgba(0,0,0,0.3)" }}>
        <View className="overflow-hidden rounded-t-3xl bg-cream" style={{ height: "92%" }}>
          {visible ? <SettingsContent onClose={onClose} initial={initial} onSave={onSave} mealFilter={mealFilter} /> : null}
        </View>
      </View>
    </Modal>
  );
}
