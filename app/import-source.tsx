import React from "react";
import { View, Image, Linking, ScrollView, Dimensions, NativeSyntheticEvent, NativeScrollEvent } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Backdrop } from "../components/recime/Backdrop";
import { VStack, HStack, Center, Text, Heading, Pressable, Button, ButtonText, Icon } from "../components/ui";
import {
  SAMPLE_RECIPE_URL,
  PLATFORM_LINK,
  SOCIAL_PLATFORMS,
  type SocialPlatform,
} from "../lib/sampleRecipes";

const { width: SCREEN_W } = Dimensions.get("window");

function isPlatform(v: string | undefined): v is SocialPlatform {
  return !!v && (SOCIAL_PLATFORMS as readonly string[]).includes(v);
}

/**
 * Per-platform import coaching. A swipeable carousel teaches the share gesture,
 * then two actions: "Open {Platform}" deep-links into the native app (educational
 * — the share-back needs the iOS Share Extension, not shipped this wave), and
 * "Try with a sample recipe" runs a real import of a fixed sample URL.
 */
export default function ImportSource() {
  const router = useRouter();
  const params = useLocalSearchParams<{ source?: string }>();
  const source: SocialPlatform = isPlatform(params.source) ? params.source : "Pinterest";
  const [page, setPage] = React.useState(0);

  // Deep-link into the app; iOS canOpenURL needs the scheme whitelisted, so we
  // just attempt openURL and fall back to the https homepage on any failure —
  // the button always does something.
  const openApp = async () => {
    const { scheme, web } = PLATFORM_LINK[source];
    try {
      await Linking.openURL(scheme);
    } catch {
      try {
        await Linking.openURL(web);
      } catch {
        // nothing we can do; the sample path is the reliable route
      }
    }
  };

  const trySample = () => {
    router.replace(`/importing?url=${encodeURIComponent(SAMPLE_RECIPE_URL[source])}`);
  };

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    setPage(Math.round(e.nativeEvent.contentOffset.x / SCREEN_W));
  };

  const slides: { caption: string; render: () => React.ReactNode }[] = [
    { caption: "Find a recipe you love, then tap the share icon", render: () => <MockPost highlight="share" /> },
    { caption: "Choose Harvest from the share menu", render: () => <MockShareSheet /> },
    { caption: "We pull in the ingredients and steps for you", render: () => <MockDone /> },
  ];

  return (
    <SafeAreaView className="flex-1 bg-cream" edges={["top", "bottom"]}>
      <Backdrop />

      <HStack className="items-center px-5 pt-2">
        <Pressable onPress={() => router.back()} className="p-1" hitSlop={10}>
          <Icon name="chevron-back" size={26} color="#2E2419" />
        </Pressable>
      </HStack>

      <VStack className="flex-1 px-6 pt-2" space={4}>
        <Heading className="text-2xl">Import from {source}</Heading>

        <View className="flex-1">
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onScroll={onScroll}
            scrollEventThrottle={16}
            style={{ marginHorizontal: -24 }}
          >
            {slides.map((slide, i) => (
              <View key={i} style={{ width: SCREEN_W }} className="px-6">
                <Center className="flex-1">
                  {slide.render()}
                  <Text className="mt-4 px-4 text-center text-base font-semibold text-brand-dark">{slide.caption}</Text>
                </Center>
              </View>
            ))}
          </ScrollView>

          <HStack className="justify-center pb-2" space={6}>
            {slides.map((_, i) => (
              <View
                key={i}
                className="h-2 rounded-full"
                style={{ width: i === page ? 18 : 8, backgroundColor: i === page ? "#A85E2B" : "#D8CDB4" }}
              />
            ))}
          </HStack>
        </View>

        <VStack space={12} className="pb-2">
          <Button className="w-full" onPress={openApp}>
            <ButtonText>Open {source} to find a recipe</ButtonText>
          </Button>
          <Pressable className="flex-row justify-center py-1" onPress={trySample}>
            <Text className="font-semibold text-brand-dark">Try with a sample recipe</Text>
          </Pressable>
        </VStack>
      </VStack>
    </SafeAreaView>
  );
}

/* ---------- coaching mocks (in-app, no screenshot assets) ---------- */

function MockPost({ highlight }: { highlight: "share" }) {
  return (
    <View className="w-64 overflow-hidden rounded-3xl border border-hairline bg-card">
      <Image source={require("../assets/recipe-bourguignon.jpg")} resizeMode="cover" style={{ width: "100%", height: 220 }} />
      <HStack className="items-center px-4 py-3" space={18}>
        <Icon name="heart-outline" size={22} color="#2E2419" />
        <Icon name="chatbubble-outline" size={22} color="#2E2419" />
        <Center className={`h-9 w-9 rounded-full ${highlight === "share" ? "bg-brand" : ""}`}>
          <Ionicons name="paper-plane-outline" size={18} color={highlight === "share" ? "#fff" : "#2E2419"} />
        </Center>
        <View className="flex-1" />
        <Icon name="bookmark-outline" size={22} color="#2E2419" />
      </HStack>
    </View>
  );
}

// The iOS share sheet is OS UI, so the sheet mock may read white per the
// AGENTS.md OS-mimic exception; the surrounding screen stays bg-cream.
function MockShareSheet() {
  const apps: { label: string; icon: React.ComponentProps<typeof Ionicons>["name"]; bg: string; harvest?: boolean }[] = [
    { label: "AirDrop", icon: "radio-outline", bg: "#4C9AE0" },
    { label: "Harvest", icon: "leaf", bg: "#A85E2B", harvest: true },
    { label: "Messages", icon: "chatbubble", bg: "#37C24A" },
  ];
  return (
    <View className="w-72 rounded-3xl bg-white p-4" style={{ borderWidth: 1, borderColor: "#E7DCC6" }}>
      <HStack className="justify-between" space={12}>
        {apps.map((a) => (
          <Center key={a.label} className="flex-1">
            <Center
              className="h-14 w-14 rounded-2xl"
              style={{ backgroundColor: a.bg, borderWidth: a.harvest ? 3 : 0, borderColor: "#5C6350" }}
            >
              <Ionicons name={a.icon} size={26} color="#fff" />
            </Center>
            <Text className="mt-1.5 text-[11px] text-muted" numberOfLines={1}>
              {a.label}
            </Text>
          </Center>
        ))}
      </HStack>
    </View>
  );
}

function MockDone() {
  return (
    <Center className="h-56 w-64 rounded-3xl border border-hairline bg-card">
      <Center className="h-20 w-20 rounded-full bg-brand-light">
        <Ionicons name="checkmark" size={44} color="#A85E2B" />
      </Center>
      <Text className="mt-4 text-lg font-bold text-ink">Saved to Harvest</Text>
    </Center>
  );
}
