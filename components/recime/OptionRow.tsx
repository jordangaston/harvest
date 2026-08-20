import React from "react";
import { Image, ImageSourcePropType } from "react-native";
import { HStack, Pressable, Text, Checkbox } from "../ui";
import { ELEVATION } from "../../lib/elevation";
import { Ionicons } from "@expo/vector-icons";

/**
 * A single selectable list row used on Goals / How-did-you-hear / Recipe-sources.
 * `image` renders a painterly icon, `emoji` a glyph, `icon` an Ionicon; `variant`
 * switches between a right-side checkbox (multi) and a bordered highlight (single).
 */
export function OptionRow({
  label,
  emoji,
  icon,
  image,
  selected,
  onPress,
  variant = "check",
}: {
  label: string;
  emoji?: string;
  icon?: React.ComponentProps<typeof Ionicons>["name"];
  image?: ImageSourcePropType;
  selected: boolean;
  onPress?: () => void;
  variant?: "check" | "pill";
}) {
  return (
    <Pressable
      onPress={onPress}
      style={ELEVATION.low}
      className={`mb-3 flex-row items-center rounded-2xl px-4 py-4 ${
        selected ? "border border-brand bg-brand-light" : "bg-card"
      }`}
    >
      <HStack className="flex-1 items-center" space={12}>
        {image ? (
          <Image source={image} resizeMode="contain" style={{ width: 40, height: 40 }} />
        ) : null}
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
