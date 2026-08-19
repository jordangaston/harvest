import React from "react";
import { View } from "react-native";
import { VStack, HStack, Text, Pressable, Icon } from "../ui";
import { ELEVATION } from "../../lib/elevation";

export type MealType = "breakfast" | "lunch" | "dinner" | "snack" | "kids";
export type WeekPlan = { meals: Record<MealType, number> };

const MEALS: { key: MealType; label: string }[] = [
  { key: "breakfast", label: "Breakfasts" },
  { key: "lunch", label: "Lunches" },
  { key: "dinner", label: "Dinners" },
  { key: "snack", label: "Snacks" },
  { key: "kids", label: "Kids meals" },
];
const MAX_PER_MEAL = 21;

const DEFAULT_PLAN: WeekPlan = {
  meals: { breakfast: 0, lunch: 0, dinner: 5, snack: 0, kids: 0 },
};

/**
 * A − n + counter where the *number* is the hero. The buttons are flat and muted so they recede
 * (the value is the answer, not the control); the − also dims and goes inert at the floor so 0
 * reads as a real state. (Refactoring UI Ch2: emphasise the data, de-emphasise the control.)
 */
function Stepper({ value, onChange, min = 0, max = MAX_PER_MEAL, label }: { value: number; onChange: (v: number) => void; min?: number; max?: number; label: string }) {
  const StepBtn = ({ dir, disabled }: { dir: "down" | "up"; disabled: boolean }) => (
    <Pressable
      onPress={() => onChange(dir === "up" ? Math.min(max, value + 1) : Math.max(min, value - 1))}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={`${dir === "up" ? "More" : "Fewer"} ${label}`}
      hitSlop={8}
      className="items-center justify-center rounded-full bg-sand-200"
      style={[{ width: 30, height: 30 }, disabled ? { opacity: 0.35 } : undefined]}
    >
      <Icon name={dir === "up" ? "add" : "remove"} size={16} color="#6E5B48" />
    </Pressable>
  );
  return (
    <HStack className="items-center" space={12}>
      <StepBtn dir="down" disabled={value <= min} />
      <Text className={`text-2xl ${value > 0 ? "text-ink" : "text-sand-400"}`} style={{ fontFamily: "Karla_700Bold", minWidth: 28, textAlign: "center" }}>{value}</Text>
      <StepBtn dir="up" disabled={value >= max} />
    </HStack>
  );
}

/**
 * Gathers how many of each meal the user wants in a week. One question, one unit ("each week"),
 * so there's a single obvious mental model — no day/quantity cross-talk to reconcile. Holds a
 * local draft and hands the finished WeekPlan to onSubmit. The only saturated colour is the
 * primary action (golden-hour design system).
 */
export function MealPlanIntake({ initial = DEFAULT_PLAN, onSubmit }: { initial?: WeekPlan; onSubmit?: (plan: WeekPlan) => void }) {
  const [plan, setPlan] = React.useState<WeekPlan>(initial);
  const setMeal = (m: MealType, v: number) => setPlan((s) => ({ meals: { ...s.meals, [m]: v } }));

  const mealCount = MEALS.reduce((n, m) => n + plan.meals[m.key], 0);
  const ready = mealCount > 0;

  return (
    <View style={{ padding: 20 }}>
      <VStack space={20}>
        <View className="rounded-2xl bg-card p-5" style={[{ gap: 18 }, ELEVATION.medium]}>
          <Text className="text-lg text-ink" style={{ fontFamily: "Karla_700Bold" }}>How many meals each week?</Text>
          <VStack space={16}>
            {MEALS.map((m) => (
              <HStack key={m.key} className="items-center justify-between">
                <Text className="text-base text-ink">{m.label}</Text>
                <Stepper value={plan.meals[m.key]} onChange={(v) => setMeal(m.key, v)} label={m.label.toLowerCase()} />
              </HStack>
            ))}
          </VStack>
        </View>

        <VStack space={12} className="items-center">
          <Text className="text-sm text-muted">
            {mealCount} {mealCount === 1 ? "meal" : "meals"} a week
          </Text>
          <Pressable
            onPress={() => onSubmit?.(plan)}
            disabled={!ready}
            accessibilityRole="button"
            accessibilityLabel="Continue"
            className="w-full items-center rounded-full bg-brand py-3.5"
            style={ready ? ELEVATION.medium : { opacity: 0.4 }}
          >
            <Text className="text-base font-bold text-white">Continue</Text>
          </Pressable>
        </VStack>
      </VStack>
    </View>
  );
}
