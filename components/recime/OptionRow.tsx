import React from "react";
import { HStack, Pressable, Text, Checkbox } from "../ui";
import { Ionicons } from "@expo/vector-icons";

/**
 * A single selectable list row used on Goals / How-did-you-hear / Recipe-sources.
 * `emoji` renders a leading glyph; `variant` switches between a right-side checkbox
 * (multi-select) and a bordered highlight (single-select pill).
 */
export function OptionRow({
  label,
  emoji,
  icon,
  selected,
  onPress,
  variant = "check",
}: {
  label: string;
  emoji?: string;
  icon?: React.ComponentProps<typeof Ionicons>["name"];
  selected: boolean;
  onPress?: () => void;
  variant?: "check" | "pill";
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`mb-3 flex-row items-center rounded-2xl border px-4 py-4 ${
        selected ? "border-brand bg-brand-light" : "border-hairline bg-card"
      }`}
    >
      <HStack className="flex-1 items-center" space={12}>
        {emoji ? <Text className="text-lg">{emoji}</Text> : null}
        {icon ? <Ionicons name={icon} size={20} color="#2E2419" /> : null}
        <Text className="flex-1 text-base text-ink">{label}</Text>
        {variant === "check" ? (
          <Checkbox checked={selected} onToggle={onPress} />
        ) : selected ? (
          <Ionicons name="checkmark-circle" size={22} color="#A85E2B" />
        ) : null}
      </HStack>
    </Pressable>
  );
}
