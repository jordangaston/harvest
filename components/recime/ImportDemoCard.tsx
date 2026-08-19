import React from "react";
import { View, Image, Animated, Easing, ImageSourcePropType } from "react-native";
import { Image as ExpoImage } from "expo-image";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { VStack, HStack, Center, Text, Pressable } from "../ui";
import { ELEVATION } from "../../lib/elevation";
import { CookingLoaderText } from "./CookingLoaderText";

type Stage = "source" | "sheet" | "importing";
type Variant = "social" | "web";

/**
 * Interactive "here's how to import" demo, mirroring the onboarding recording.
 * The user drives it: tap the share icon → the iOS share sheet appears → tap
 * Harvest → a brief "Importing…" → onDone. Coach marks point at each next tap.
 */
export function ImportDemoCard({
  variant,
  image,
  onDone,
}: {
  variant: Variant;
  image: ImageSourcePropType;
  onDone: () => void;
}) {
  const [stage, setStage] = React.useState<Stage>("source");

  // Restart from the beginning whenever the screen is (re)focused.
  useFocusEffect(React.useCallback(() => setStage("source"), []));

  // The one automated beat: the import "runs" for a moment, then reveals the recipe.
  React.useEffect(() => {
    if (stage !== "importing") return;
    const t = setTimeout(onDone, 1600);
    return () => clearTimeout(t);
  }, [stage, onDone]);

  return (
    <View className="h-[440px] w-full overflow-hidden rounded-[28px] border border-hairline bg-card">
      {/* base layer: the source (dims while the sheet is up) */}
      <View style={{ opacity: stage === "source" ? 1 : 0.45 }} pointerEvents={stage === "source" ? "auto" : "none"}>
        {variant === "social" ? (
          <SocialPost image={image} live={stage === "source"} onShare={() => setStage("sheet")} />
        ) : (
          <WebPage image={image} live={stage === "source"} onShare={() => setStage("sheet")} />
        )}
      </View>

      {stage === "sheet" ? <ShareSheet onPickHarvest={() => setStage("importing")} /> : null}
      {stage === "importing" ? <ImportingOverlay /> : null}
    </View>
  );
}

/* ---------- source: Instagram-style post ---------- */

function SocialPost({ image, live, onShare }: { image: ImageSourcePropType; live: boolean; onShare: () => void }) {
  return (
    <View>
      <HStack className="items-center px-4 py-3" space={10}>
        <Center className="h-9 w-9 rounded-full bg-sand">
          <Text className="text-sm">👩‍🍳</Text>
        </Center>
        <VStack className="flex-1">
          <Text className="text-sm font-bold text-ink">recipe.app</Text>
          <Text className="text-xs text-muted">Original recipe</Text>
        </VStack>
        <Ionicons name="ellipsis-horizontal" size={18} color="#6E5B48" />
      </HStack>

      <Image source={image} resizeMode="cover" style={{ width: "100%", height: 250 }} />

      <View className="px-4 pt-3">
        <Text className="text-sm text-ink" numberOfLines={1}>
          <Text className="font-bold text-ink">recipe.app</Text> The best beef bourguignon 🍷
        </Text>
        <HStack className="mt-3 items-center" space={20}>
          <Ionicons name="heart-outline" size={26} color="#2E2419" />
          <Ionicons name="chatbubble-outline" size={24} color="#2E2419" />
          <ShareTarget live={live} onPress={onShare} />
          <View className="flex-1" />
          <Ionicons name="bookmark-outline" size={24} color="#2E2419" />
        </HStack>
      </View>
    </View>
  );
}

/* ---------- source: recipe website in a browser ---------- */

function WebPage({ image, live, onShare }: { image: ImageSourcePropType; live: boolean; onShare: () => void }) {
  return (
    <View>
      <HStack className="items-center justify-between border-b border-hairline px-4 py-3">
        <Ionicons name="menu" size={18} color="#6E5B48" />
        <Center className="h-6 w-11 rounded-md bg-[#C05621]">
          <Text className="text-[9px] font-extrabold text-white">nom</Text>
        </Center>
        <HStack space={14}>
          <Ionicons name="search" size={15} color="#6E5B48" />
          <Ionicons name="bookmark-outline" size={15} color="#6E5B48" />
        </HStack>
      </HStack>

      <View className="px-4 pt-3">
        <Text className="text-lg font-bold text-ink">Banana Walnut Bread</Text>
        <HStack className="mt-1.5 items-center" space={6}>
          <HStack space={1}>
            {[0, 1, 2, 3, 4].map((i) => (
              <Ionicons key={i} name="star" size={13} color="#E0A32E" />
            ))}
          </HStack>
          <Text className="text-xs text-muted">1,093 reviews</Text>
        </HStack>
        <Text className="mt-2 text-xs leading-5 text-muted">
          The best way to use overripe bananas — moist, nutty, and impossibly easy.
        </Text>
      </View>

      <View className="mt-3">
        <Image source={image} resizeMode="cover" style={{ width: "100%", height: 190 }} />
      </View>

      {/* Safari-style bottom bar with the share button highlighted */}
      <HStack className="items-center justify-between border-t border-hairline px-6 py-3">
        <Ionicons name="chevron-back" size={20} color="#B8A88E" />
        <Ionicons name="chevron-forward" size={20} color="#B8A88E" />
        <ShareTarget live={live} filled coachAbove onPress={onShare} />
        <Ionicons name="copy-outline" size={20} color="#B8A88E" />
        <Ionicons name="albums-outline" size={20} color="#B8A88E" />
      </HStack>
    </View>
  );
}

/* ---------- the share icon + "Tap here" coach mark ---------- */

function ShareTarget({
  live,
  filled = false,
  onPress,
  coachAbove = false,
}: {
  live: boolean;
  filled?: boolean;
  onPress: () => void;
  coachAbove?: boolean;
}) {
  return (
    <View>
      <Pressable onPress={onPress} hitSlop={16}>
        <Center className={`h-11 w-11 rounded-full ${filled ? "bg-brand" : "border-2 border-brand"}`}>
          <Ionicons name="share-outline" size={22} color={filled ? "#fff" : "#A85E2B"} />
        </Center>
      </Pressable>
      {live ? (
        <View
          style={{ position: "absolute", top: coachAbove ? -46 : 48, left: -32, width: 108, alignItems: "center" }}
          pointerEvents="none"
        >
          <CoachMark up={!coachAbove} />
        </View>
      ) : null}
    </View>
  );
}

/* ---------- iOS share sheet with Harvest highlighted ---------- */

const APPS: { label: string; icon: keyof typeof Ionicons.glyphMap; bg: string; harvest?: boolean }[] = [
  { label: "AirDrop", icon: "radio-outline", bg: "#4C9AE0" },
  { label: "Harvest", icon: "leaf", bg: "#A85E2B", harvest: true },
  { label: "Messages", icon: "chatbubble", bg: "#37C24A" },
  { label: "Mail", icon: "mail", bg: "#3B82F6" },
];

function ShareSheet({ onPickHarvest }: { onPickHarvest: () => void }) {
  return (
    <View className="absolute inset-0 justify-end bg-black/25">
      <View className="rounded-t-[26px] bg-cream px-4 pb-6 pt-3">
        <Center className="mb-3">
          <View className="h-1 w-10 rounded-full bg-hairline" />
        </Center>

        <HStack className="items-end justify-between px-2 pb-4">
          {APPS.map((app) => (
            <Center key={app.label} className="w-16">
              <View style={{ position: "relative" }}>
                <Pressable onPress={app.harvest ? onPickHarvest : undefined} hitSlop={10}>
                  {app.harvest ? (
                    <View
                      className="h-14 w-14 overflow-hidden rounded-2xl"
                      style={{ borderWidth: 3, borderColor: "#5C6350" }}
                    >
                      <Image
                        source={require("../../assets/logo-mark.png")}
                        resizeMode="cover"
                        style={{ width: "100%", height: "100%" }}
                      />
                    </View>
                  ) : (
                    <Center className="h-14 w-14 rounded-2xl" style={{ backgroundColor: app.bg }}>
                      <Ionicons name={app.icon} size={26} color="#fff" />
                    </Center>
                  )}
                </Pressable>
                {app.harvest ? (
                  <View style={{ position: "absolute", top: 60, left: -26, width: 108, alignItems: "center" }} pointerEvents="none">
                    <CoachMark up />
                  </View>
                ) : null}
              </View>
              <Text className="mt-1.5 text-[11px] text-muted" numberOfLines={1}>
                {app.label}
              </Text>
            </Center>
          ))}
        </HStack>

        <View className="mt-8 overflow-hidden rounded-2xl bg-card" style={ELEVATION.low}>
          <HStack className="items-center justify-between px-4 py-3.5">
            <Text className="text-base text-ink">Copy</Text>
            <Ionicons name="copy-outline" size={20} color="#2E2419" />
          </HStack>
          <View className="h-px w-full bg-hairline" />
          <HStack className="items-center justify-between px-4 py-3.5">
            <Text className="text-base text-ink">Add to Reading List</Text>
            <Ionicons name="glasses-outline" size={20} color="#2E2419" />
          </HStack>
        </View>
      </View>
    </View>
  );
}

/* ---------- importing overlay ---------- */

function ImportingOverlay() {
  return (
    <Center className="absolute inset-0 bg-ink/30">
      <VStack
        className="items-center justify-center rounded-3xl border border-hairline bg-cream"
        style={[{ width: 280, height: 356 }, ELEVATION.high]}
      >
        <ExpoImage
          source={require("../../assets/loader.webp")}
          contentFit="contain"
          style={{ width: 116, height: 176 }}
        />
        <View className="mt-3">
          <CookingLoaderText size={24} />
        </View>
      </VStack>
    </Center>
  );
}

/* ---------- pulsing "Tap here" pill ---------- */

function CoachMark({ up = true }: { up?: boolean }) {
  const scale = React.useRef(new Animated.Value(1)).current;

  React.useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.12, duration: 600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1, duration: 600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [scale]);

  const caret = <Ionicons name={up ? "caret-up" : "caret-down"} size={16} color="#A85E2B" />;

  return (
    <Animated.View style={{ transform: [{ scale }], alignItems: "center" }}>
      {up ? <View style={{ marginBottom: -4 }}>{caret}</View> : null}
      <View className="flex-row items-center rounded-full bg-brand px-3.5 py-2 shadow-lg">
        <Ionicons name="hand-left" size={15} color="#fff" />
        <Text numberOfLines={1} className="ml-1.5 text-sm font-bold text-white">Tap here</Text>
      </View>
      {!up ? <View style={{ marginTop: -4 }}>{caret}</View> : null}
    </Animated.View>
  );
}
