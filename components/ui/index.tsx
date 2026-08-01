/**
 * Gluestack-style primitive layer.
 *
 * The gluestack-ui v2 CLI can't run in this environment (it needs an interactive
 * TTY and its alpha packages conflict with Expo SDK 57's dependency graph), so
 * these primitives mirror the gluestack-ui API — <Box>, <VStack>, <HStack>,
 * <Text>, <Heading>, <Button>/<ButtonText>, <Icon>, <Image>, <Checkbox>,
 * <Switch>, <Input>, <Divider>, <Spinner> — built on NativeWind + tailwind-variants
 * (the same `tva` variant engine gluestack uses internally). Same DX, same visuals.
 */
import React from "react";
import {
  View,
  Text as RNText,
  Pressable as RNPressable,
  Image as RNImage,
  Switch as RNSwitch,
  TextInput,
  ActivityIndicator,
  ScrollView as RNScrollView,
  ViewProps,
  TextProps,
  PressableProps,
  ImageProps,
  TextInputProps,
} from "react-native";
import { tv } from "tailwind-variants";
import { Ionicons } from "@expo/vector-icons";

type WithClass<T> = T & { className?: string };

/* ---------- Layout ---------- */
export function Box({ className, ...props }: WithClass<ViewProps>) {
  return <View className={className} {...props} />;
}

export function VStack({
  className,
  space,
  ...props
}: WithClass<ViewProps> & { space?: number }) {
  const gap = space != null ? { gap: space } : undefined;
  return <View className={`flex-col ${className ?? ""}`} style={gap} {...props} />;
}

export function HStack({
  className,
  space,
  ...props
}: WithClass<ViewProps> & { space?: number }) {
  const gap = space != null ? { gap: space } : undefined;
  return <View className={`flex-row ${className ?? ""}`} style={gap} {...props} />;
}

export function Center({ className, ...props }: WithClass<ViewProps>) {
  return <View className={`items-center justify-center ${className ?? ""}`} {...props} />;
}

export function ScrollView({ className, ...props }: WithClass<React.ComponentProps<typeof RNScrollView>>) {
  return <RNScrollView className={className} {...props} />;
}

export function Divider({ className, ...props }: WithClass<ViewProps>) {
  return <View className={`h-px w-full bg-hairline ${className ?? ""}`} {...props} />;
}

/* ---------- Typography ---------- */
export function Text({ className, style, ...props }: WithClass<TextProps>) {
  return (
    <RNText
      className={`text-ink ${className ?? ""}`}
      style={[{ fontFamily: "Karla_400Regular" }, style]}
      {...props}
    />
  );
}

export function Heading({ className, style, ...props }: WithClass<TextProps>) {
  return (
    <RNText
      className={`text-ink text-2xl ${className ?? ""}`}
      style={[{ fontFamily: "Karla_700Bold" }, style]}
      {...props}
    />
  );
}

/* ---------- Pressable ---------- */
export function Pressable({ className, ...props }: WithClass<PressableProps>) {
  return (
    <RNPressable
      className={className}
      style={({ pressed }) => (pressed ? { opacity: 0.85 } : undefined)}
      {...props}
    />
  );
}

/* ---------- Button ---------- */
const button = tv({
  base: "flex-row items-center justify-center rounded-full",
  variants: {
    variant: {
      solid: "",
      outline: "border bg-transparent",
      link: "bg-transparent",
    },
    action: {
      brand: "bg-brand",
      plus: "bg-plus",
      dark: "bg-ink",
      light: "bg-white border border-hairline",
    },
    size: {
      lg: "h-14 px-6",
      md: "h-12 px-5",
      sm: "h-10 px-4",
    },
  },
  defaultVariants: { variant: "solid", action: "brand", size: "lg" },
});

type ButtonProps = WithClass<PressableProps> & {
  action?: "brand" | "plus" | "dark" | "light";
  variant?: "solid" | "outline" | "link";
  size?: "lg" | "md" | "sm";
};

export function Button({
  className,
  action,
  variant,
  size,
  children,
  ...props
}: ButtonProps) {
  return (
    <RNPressable
      className={button({ action, variant, size, className })}
      style={({ pressed }) => (pressed ? { opacity: 0.9 } : undefined)}
      {...props}
    >
      {children}
    </RNPressable>
  );
}

export function ButtonText({ className, style, ...props }: WithClass<TextProps>) {
  return (
    <RNText
      className={`text-white text-base ${className ?? ""}`}
      style={[{ fontFamily: "Karla_700Bold" }, style]}
      {...props}
    />
  );
}

/* ---------- Image ---------- */
export function Image({ className, ...props }: WithClass<ImageProps>) {
  return <RNImage className={className} {...props} />;
}

/* ---------- Icon ---------- */
export function Icon({
  name,
  size = 22,
  color = "#2E2419",
}: {
  name: React.ComponentProps<typeof Ionicons>["name"];
  size?: number;
  color?: string;
}) {
  return <Ionicons name={name} size={size} color={color} />;
}

/* ---------- Checkbox (square, checkmark) ---------- */
export function Checkbox({
  checked,
  onToggle,
  className,
}: {
  checked: boolean;
  onToggle?: () => void;
  className?: string;
}) {
  return (
    <RNPressable onPress={onToggle} className={className}>
      <View
        className={`h-6 w-6 items-center justify-center rounded-md border ${
          checked ? "border-brand bg-brand" : "border-hairline bg-white"
        }`}
      >
        {checked ? <Ionicons name="checkmark" size={16} color="#fff" /> : null}
      </View>
    </RNPressable>
  );
}

/* ---------- Radio (circle) ---------- */
export function Radio({
  selected,
  onSelect,
  color = "#A85E2B",
  className,
}: {
  selected: boolean;
  onSelect?: () => void;
  color?: string;
  className?: string;
}) {
  return (
    <RNPressable onPress={onSelect} className={className}>
      <View
        className="h-6 w-6 items-center justify-center rounded-full border-2"
        style={{ borderColor: selected ? color : "#C7B89A" }}
      >
        {selected ? (
          <View className="h-3 w-3 rounded-full" style={{ backgroundColor: color }} />
        ) : null}
      </View>
    </RNPressable>
  );
}

/* ---------- Switch ---------- */
export function Switch({
  value,
  onValueChange,
  color = "#A85E2B",
}: {
  value: boolean;
  onValueChange?: (v: boolean) => void;
  color?: string;
}) {
  return (
    <RNSwitch
      value={value}
      onValueChange={onValueChange}
      trackColor={{ true: color, false: "#D8CDB4" }}
      thumbColor="#fff"
      ios_backgroundColor="#D8CDB4"
    />
  );
}

/* ---------- Input ---------- */
export function Input({ className, style, ...props }: WithClass<TextInputProps>) {
  return (
    <TextInput
      placeholderTextColor="#9C8460"
      className={`h-12 rounded-xl border border-field bg-card px-4 text-ink ${className ?? ""}`}
      style={[{ fontFamily: "Karla_400Regular" }, style]}
      {...props}
    />
  );
}

/* ---------- Spinner ---------- */
export function Spinner({ color = "#A85E2B" }: { color?: string }) {
  return <ActivityIndicator color={color} />;
}
