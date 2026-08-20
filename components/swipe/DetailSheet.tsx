import React from "react";
import { Modal, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ScrollView, VStack, HStack, Text, Pressable, Icon, Divider } from "../ui";
import { ELEVATION } from "../../lib/elevation";
import { DeckCard, money, formatTime, difficultyLabel } from "./mock";

const SIGNAL_LABEL: Record<string, string> = {
  cost: "Cost", difficulty: "Difficulty", nutrition: "Nutrition",
  affinity: "Your taste", time: "Time", meal_prep: "Meal prep",
};

// The real value behind each signal — users understand "$3.50/serving", not "85%".
const RAW: Record<string, (r: DeckCard["recipe"]) => string> = {
  cost: (r) => `${money(r.costCents)}/serving`,
  time: (r) => formatTime(r.totalMinutes),
  difficulty: (r) => difficultyLabel(r.difficulty),
  nutrition: (r) => (r.nrf >= 65 ? "Nutrient-dense" : "Balanced"),
  affinity: (r) => r.likedNote,
  meal_prep: (r) => (r.mealPrepFit === "designed" ? "Designed for it" : r.mealPrepFit === "suitable" ? "Keeps well" : "Best fresh"),
};

/** One breakdown row — the real value, with the bar as a quiet strength cue (width, not %). */
function WhyBar({ label, raw, value }: { label: string; raw: string; value: number }) {
  return (
    <VStack space={4}>
      <HStack className="justify-between">
        <Text className="text-sm font-semibold text-ink">{label}</Text>
        <Text className="text-sm font-semibold text-muted">{raw}</Text>
      </HStack>
      <View className="h-2 w-full overflow-hidden rounded-full bg-sand">
        <View className="h-2 rounded-full bg-brand" style={{ width: `${Math.round(value * 100)}%` }} />
      </View>
    </VStack>
  );
}

/**
 * Expandable recipe detail — ingredients, a step preview, full metadata, and the
 * "why this is ranked for you" breakdown as labeled bars. A bg-cream sheet (the
 * design-system modal tone) with bg-card rows lifting off it.
 */
export function DetailSheet({ card, visible, onClose }: { card: DeckCard | null; visible: boolean; onClose: () => void }) {
  if (!card) return null;
  const r = card.recipe;
  // Same 0.5 floor as buildWhyLine — the bars and the "why" headline tell one story (fa-6).
  const bars = Object.entries(card.breakdown).filter(([, v]) => v >= 0.5).sort((a, b) => b[1] - a[1]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View className="flex-1 justify-end" style={{ backgroundColor: "rgba(0,0,0,0.3)" }}>
        <View className="overflow-hidden rounded-t-3xl bg-cream" style={{ maxHeight: "88%" }}>
          <SafeAreaView edges={["bottom"]}>
            <HStack className="items-center justify-between px-5 pb-2 pt-4">
              <Text className="text-xl text-ink" style={{ fontFamily: "Karla_700Bold" }} numberOfLines={1}>
                {r.title}
              </Text>
              <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close details" className="rounded-full bg-card p-2">
                <Icon name="close" size={20} color="#2E2419" />
              </Pressable>
            </HStack>

            <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 8, gap: 20 }}>
              <HStack space={8} className="flex-wrap">
                <MetaChip icon="time-outline" label={formatTime(r.totalMinutes)} />
                <MetaChip icon="pricetag-outline" label={`${money(r.costCents)}/serving`} />
                <MetaChip icon="speedometer-outline" label={difficultyLabel(r.difficulty)} />
                {r.compat.map((c) => <MetaChip key={c} icon="checkmark-circle" label={c} />)}
              </HStack>

              <View className="rounded-2xl bg-card p-4" style={[{ gap: 12 }, ELEVATION.medium]}>
                <Text className="text-xs font-bold uppercase tracking-wide text-muted">Why this is ranked for you</Text>
                {bars.map(([sig, v]) => <WhyBar key={sig} label={SIGNAL_LABEL[sig] ?? sig} raw={RAW[sig]?.(r) ?? ""} value={v} />)}
              </View>

              {r.macros ? <NutritionCard macros={r.macros} /> : null}

              <VStack space={10}>
                <Text className="text-xs font-bold uppercase tracking-wide text-muted">Ingredients</Text>
                <View className="rounded-2xl bg-card" style={ELEVATION.medium}>
                  {r.ingredients.map((ing, i) => (
                    <View key={ing.name}>
                      {i > 0 ? <Divider /> : null}
                      <HStack space={12} className="items-center px-3 py-2.5">
                        {/* Placeholder for the ingredient image — real ingredient PNGs slot in here. */}
                        <View className="h-10 w-10 items-center justify-center rounded-full bg-brand-light">
                          <Icon name="nutrition-outline" size={18} color="#A85E2B" />
                        </View>
                        <Text className="flex-1 text-base text-ink">
                          <Text className="font-bold text-ink">{ing.qty} </Text>{ing.name}
                        </Text>
                      </HStack>
                    </View>
                  ))}
                </View>
              </VStack>

              <VStack space={10}>
                <Text className="text-xs font-bold uppercase tracking-wide text-muted">Steps</Text>
                {r.steps.map((step, i) => (
                  <HStack key={i} space={12} className="items-start">
                    <View className="mt-0.5 h-6 w-6 items-center justify-center rounded-full bg-brand-light">
                      <Text className="text-xs font-bold text-brand">{i + 1}</Text>
                    </View>
                    <Text className="flex-1 text-base text-ink">{step}</Text>
                  </HStack>
                ))}
              </VStack>
            </ScrollView>
          </SafeAreaView>
        </View>
      </View>
    </Modal>
  );
}

// FDA Daily Values (grams) for the per-serving %DV shown on each macro bar.
const DV = { protein: 50, carbs: 275, fat: 78 };

/** Per-serving nutrition: calories + Protein/Carbs/Fat, each a %-daily-value bar. Light theme. */
function NutritionCard({ macros }: { macros: NonNullable<DeckCard["recipe"]["macros"]> }) {
  const items = [
    { label: "Protein", g: macros.protein, dv: DV.protein },
    { label: "Carbs", g: macros.carbs, dv: DV.carbs },
    { label: "Fat", g: macros.fat, dv: DV.fat },
  ].filter((m): m is { label: string; g: number; dv: number } => m.g != null);
  if (macros.calories == null && !items.length) return null;
  return (
    <View className="rounded-2xl bg-card p-4" style={[{ gap: 12 }, ELEVATION.medium]}>
      <HStack className="items-baseline justify-between">
        <Text className="text-xs font-bold uppercase tracking-wide text-muted">Nutrition</Text>
        <Text className="text-xs text-muted">per serving</Text>
      </HStack>
      {macros.calories != null ? (
        <HStack className="items-baseline" space={6}>
          <Text className="text-3xl text-ink" style={{ fontFamily: "Karla_700Bold" }}>{Math.round(macros.calories)}</Text>
          <Text className="text-base text-muted">calories</Text>
        </HStack>
      ) : null}
      <VStack space={10}>
        {items.map((m) => {
          const pct = Math.min(1, m.g / m.dv);
          return (
            <View key={m.label} style={{ gap: 4 }}>
              <HStack className="items-baseline justify-between">
                <Text className="text-sm font-semibold text-ink">{m.label}</Text>
                <Text className="text-sm text-muted">{Math.round(m.g)}g · {Math.round(pct * 100)}% DV</Text>
              </HStack>
              <View className="h-2 rounded-full bg-sand-200">
                <View className="h-2 rounded-full bg-brand" style={{ width: `${pct * 100}%` }} />
              </View>
            </View>
          );
        })}
      </VStack>
    </View>
  );
}

function MetaChip({ icon, label }: { icon: React.ComponentProps<typeof Icon>["name"]; label: string }) {
  return (
    <HStack space={5} className="items-center rounded-full bg-card px-3 py-1.5">
      <Icon name={icon} size={14} color="#6E5B48" />
      <Text className="text-sm font-semibold text-ink">{label}</Text>
    </HStack>
  );
}
