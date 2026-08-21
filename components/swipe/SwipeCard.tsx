import React from "react";
import { View, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Text, Pressable, Icon } from "../ui";
import { ELEVATION } from "../../lib/elevation";
import {
  DeckCard, buildWhyLine, money, formatTime, difficultyLabel,
} from "./mock";

/** Translucent-dark pill over the photo (Bumble's treatment — never reads white). */
const OVERLAY = "rgba(28,19,8,0.52)";
const OVERLAY_TEXT = "#F6EFDF";
function Badge({ icon, label }: { icon: React.ComponentProps<typeof Icon>["name"]; label: string }) {
  return (
    <View className="flex-row items-center rounded-full px-2.5 py-1" style={{ gap: 4, backgroundColor: OVERLAY }}>
      <Icon name={icon} size={13} color={OVERLAY_TEXT} />
      <Text className="text-xs font-semibold" style={{ color: OVERLAY_TEXT }}>{label}</Text>
    </View>
  );
}

// FDA Daily Values (grams) for the per-serving % daily value shown on each macro bar.
const DV = { protein: 50, carbs: 275, fat: 78 };
const MACRO_FILL = "#E9C77E";

/** Per-serving macros as a compact visual: calories + Protein/Carbs/Fat, each a
 * %-daily-value bar with grams. Sits over the photo scrim. */
function MacroStrip({ macros }: { macros: NonNullable<DeckCard["recipe"]["macros"]> }) {
  const items = [
    { label: "Protein", g: macros.protein, dv: DV.protein },
    { label: "Carbs", g: macros.carbs, dv: DV.carbs },
    { label: "Fat", g: macros.fat, dv: DV.fat },
  ].filter((m): m is { label: string; g: number; dv: number } => m.g != null);
  if (!items.length) return null;
  return (
    <View className="flex-row items-center rounded-2xl px-3 py-2" style={{ gap: 12, backgroundColor: OVERLAY }}>
      {macros.calories != null ? (
        <View className="items-center" style={{ minWidth: 34 }}>
          <Text className="text-sm font-bold" style={{ color: OVERLAY_TEXT }}>{Math.round(macros.calories)}</Text>
          <Text style={{ color: OVERLAY_TEXT, opacity: 0.7, fontSize: 10 }}>cal</Text>
        </View>
      ) : null}
      {items.map((m) => {
        const pct = Math.min(1, m.g / m.dv);
        return (
          <View key={m.label} className="flex-1" style={{ gap: 3 }}>
            <View className="flex-row items-baseline justify-between">
              <Text className="text-xs font-bold" style={{ color: OVERLAY_TEXT }}>{m.label}</Text>
              <Text style={{ color: OVERLAY_TEXT, opacity: 0.75, fontSize: 10 }}>{Math.round(m.g)}g · {Math.round(pct * 100)}%</Text>
            </View>
            <View className="h-1.5 rounded-full" style={{ backgroundColor: "rgba(255,255,255,0.22)" }}>
              <View className="h-1.5 rounded-full" style={{ width: `${pct * 100}%`, backgroundColor: MACRO_FILL }} />
            </View>
          </View>
        );
      })}
    </View>
  );
}

/**
 * Presentational recipe card — hero photo, scrim, title, plain-language "why for
 * you" line, and the at-a-glance badge row. Fills its parent; the deck stacks and
 * animates it. Colours live here on plain Views (never on the animated wrapper).
 */
export function SwipeCard({ card, dimmed, onOpenDetail }: { card: DeckCard; dimmed?: boolean; onOpenDetail?: () => void }) {
  const r = card.recipe;
  const why = buildWhyLine(card);
  const nutritious = r.nrf >= 65;
  const mealPrep = r.mealPrepFit === "designed";
  const equip = r.equipment[0];

  return (
    <View className="flex-1 overflow-hidden rounded-xl2 bg-card" style={ELEVATION.high}>
      <Image source={{ uri: r.imageUrl }} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} />
      <LinearGradient
        colors={["rgba(20,12,4,0.05)", "rgba(20,12,4,0.35)", "rgba(20,12,4,0.88)"]}
        locations={[0, 0.5, 1]}
        style={StyleSheet.absoluteFill}
      />
      {dimmed ? <View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(20,12,4,0.28)" }]} /> : null}

      {/* Top-left: the "for you" score — quiet, not a loud stamp. */}
      <View className="absolute left-4 top-4 flex-row items-center rounded-full px-3 py-1.5" style={{ gap: 5, backgroundColor: OVERLAY }}>
        <Icon name="sparkles" size={13} color="#E9C77E" />
        <Text className="text-xs font-bold" style={{ color: OVERLAY_TEXT }}>For you</Text>
      </View>

      {/* Bottom content block, over the scrim. */}
      <View className="absolute inset-x-0 bottom-0 p-5" style={{ gap: 10 }}>
        <Text className="text-3xl text-white" style={{ fontFamily: "Karla_700Bold" }} numberOfLines={2}>
          {r.title}
        </Text>
        {why ? (
          <Text className="text-base text-white/90" style={{ fontFamily: "Karla_500Medium" }} numberOfLines={2}>
            {why}
          </Text>
        ) : null}

        {/* Three core badges + at most one accent — the rest lives in the detail sheet (fa-1). */}
        <View className="flex-row flex-wrap" style={{ gap: 6, marginTop: 2 }}>
          <Badge icon="time-outline" label={formatTime(r.totalMinutes)} />
          <Badge icon="pricetag-outline" label={`${money(r.costCents)}/serv`} />
          <Badge icon="speedometer-outline" label={difficultyLabel(r.difficulty)} />
          {mealPrep ? <Badge icon="cube-outline" label="Meal-prep" />
            : nutritious ? <Badge icon="leaf-outline" label="Nutritious" />
            : equip && !equip.owned ? <Badge icon="construct-outline" label={equip.label} />
            : r.compat[0] ? <Badge icon="checkmark-circle" label={r.compat[0]} />
            : null}
        </View>

        {r.macros ? <MacroStrip macros={r.macros} /> : null}

        <Pressable
          onPress={onOpenDetail}
          accessibilityRole="button"
          accessibilityLabel={`See recipe details for ${r.title}`}
          className="mt-1 flex-row items-center justify-center rounded-full py-2.5"
          style={{ gap: 6, backgroundColor: OVERLAY }}
        >
          <Text className="text-sm font-bold" style={{ color: OVERLAY_TEXT }}>Recipe details</Text>
          <Icon name="chevron-up" size={15} color={OVERLAY_TEXT} />
        </Pressable>
      </View>
    </View>
  );
}
