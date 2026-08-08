import type { MealSlot } from "../../lib/api/types";
import type { Ionicons } from "@expo/vector-icons";

type IconName = React.ComponentProps<typeof Ionicons>["name"];

/** The four meal slots in display order (also the DB enum order). Chip tints are
 * light golden-hour tokens with `text-ink`, so every chip meets WCAG AA. */
export const MEALS: { key: MealSlot; label: string; icon: IconName; chip: string }[] = [
  { key: "breakfast", label: "Breakfast", icon: "cafe-outline", chip: "bg-brand-light" },
  { key: "lunch", label: "Lunch", icon: "sunny-outline", chip: "bg-plus-light" },
  { key: "dinner", label: "Dinner", icon: "moon-outline", chip: "bg-sand" },
  { key: "snack", label: "Snack", icon: "ice-cream-outline", chip: "bg-gold/25" },
];

/** Display label for a meal slot. */
export function mealLabel(meal: MealSlot): string {
  return MEALS.find((m) => m.key === meal)?.label ?? meal;
}

/** Chip background class for a meal slot. */
export function mealChip(meal: MealSlot): string {
  return MEALS.find((m) => m.key === meal)?.chip ?? "bg-sand";
}
