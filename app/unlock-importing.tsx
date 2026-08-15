import React from "react";
import { View, Animated, Dimensions, AccessibilityInfo } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Backdrop } from "../components/recime/Backdrop";
import { VStack, HStack, Center, Text, Heading, Pressable, Button, ButtonText, Icon } from "../components/ui";
import { DURATION, EASE } from "../lib/motion";
import { useMarkShortcutDone } from "../lib/onboardingChecklist";

const { width: SCREEN_W } = Dimensions.get("window");

/**
 * "Unlock faster importing" — a coaching carousel that teaches adding Harvest to
 * the iOS share menu. Instructional only this wave (the Share Extension isn't
 * shipped), so the steps are in-app illustrations; finishing marks the checklist
 * item. Step travel uses the motion tokens and is skipped under Reduce Motion.
 */
export default function UnlockImporting() {
  const router = useRouter();
  const markShortcutDone = useMarkShortcutDone();
  const [index, setIndex] = React.useState(0);
  const slide = React.useRef(new Animated.Value(0)).current;
  const reduceMotion = React.useRef(false);

  React.useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then((on) => (reduceMotion.current = on));
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", (on) => (reduceMotion.current = on));
    return () => sub.remove();
  }, []);

  const panels = [
    { title: "Save recipes faster 🚀", body: "Add Harvest to the iOS share menu, so saving any recipe takes just one tap.", art: <ArtIntro />, cta: "Add the shortcut" },
    { title: "Step 1", body: "On the share sheet, scroll right and tap More.", art: <ArtMore />, cta: "Next" },
    { title: "Step 2", body: "Tap Edit in the top-right corner.", art: <ArtEdit />, cta: "Next" },
    { title: "Step 3", body: "Find Harvest and tap the + to add it to Favorites.", art: <ArtAdd />, cta: "Next" },
    { title: "Step 4", body: "Drag Harvest to the top so it's always easy to reach.", art: <ArtDrag />, cta: "Next" },
    { title: "Step 5", body: "Tap Done — you're all set!", art: <ArtDone />, cta: "Done" },
  ];
  const last = panels.length - 1;

  const goTo = (next: number) => {
    setIndex(next);
    if (reduceMotion.current) {
      slide.setValue(next);
      return;
    }
    Animated.timing(slide, {
      toValue: next,
      duration: next > index ? DURATION.medium : DURATION.fast, // forward slower than back
      easing: EASE.smoothOut,
      useNativeDriver: true,
    }).start();
  };

  const onPrimary = async () => {
    if (index === last) {
      await markShortcutDone();
      router.back();
      return;
    }
    goTo(index + 1);
  };

  const onBack = () => (index === 0 ? router.back() : goTo(index - 1));

  const translateX = slide.interpolate({ inputRange: [0, last], outputRange: [0, -SCREEN_W * last] });

  return (
    <SafeAreaView className="flex-1 bg-cream" edges={["top", "bottom"]}>
      <Backdrop />

      <HStack className="items-center px-5 pt-2">
        <Pressable onPress={onBack} className="p-1" hitSlop={10}>
          <Icon name={index === 0 ? "close" : "chevron-back"} size={26} color="#2E2419" />
        </Pressable>
      </HStack>

      <View className="flex-1 overflow-hidden">
        <Animated.View style={{ flex: 1, flexDirection: "row", width: SCREEN_W * panels.length, transform: [{ translateX }] }}>
          {panels.map((p, i) => (
            <View key={i} style={{ width: SCREEN_W }} className="flex-1 px-8">
              <Center className="flex-1">{p.art}</Center>
              <VStack className="pb-2" space={8}>
                <Heading className="text-2xl">{p.title}</Heading>
                <Text className="text-base text-muted">{p.body}</Text>
              </VStack>
            </View>
          ))}
        </Animated.View>
      </View>

      <VStack className="px-8 pb-2" space={12}>
        <HStack className="justify-center" space={6}>
          {panels.map((_, i) => (
            <View
              key={i}
              className="h-2 rounded-full"
              style={{ width: i === index ? 18 : 8, backgroundColor: i === index ? "#A85E2B" : "#D8CDB4" }}
            />
          ))}
        </HStack>
        <Button className="w-full" onPress={onPrimary}>
          <ButtonText>{panels[index].cta}</ButtonText>
        </Button>
      </VStack>
    </SafeAreaView>
  );
}

/* ---------- illustrations (in-app; the iOS share-sheet mocks may read white per
   the AGENTS.md OS-mimic exception; the screen chrome stays bg-cream) ---------- */

function OSCard({ children }: { children: React.ReactNode }) {
  return (
    <View className="w-72 rounded-3xl bg-white p-4" style={{ borderWidth: 1, borderColor: "#E7DCC6" }}>
      {children}
    </View>
  );
}

function HarvestTile({ ring = false }: { ring?: boolean }) {
  return (
    <Center className="h-12 w-12 rounded-2xl" style={{ backgroundColor: "#A85E2B", borderWidth: ring ? 3 : 0, borderColor: "#5C6350" }}>
      <Ionicons name="leaf" size={22} color="#fff" />
    </Center>
  );
}

function ArtIntro() {
  return (
    <OSCard>
      <HStack className="justify-between">
        {(["radio-outline", "leaf", "chatbubble"] as const).map((icon, i) => (
          <Center key={i} className="flex-1">
            <Center
              className="h-12 w-12 rounded-2xl"
              style={{ backgroundColor: ["#4C9AE0", "#A85E2B", "#37C24A"][i], borderWidth: i === 1 ? 3 : 0, borderColor: "#5C6350" }}
            >
              <Ionicons name={icon} size={22} color="#fff" />
            </Center>
            <Text className="mt-1.5 text-[11px]" style={{ color: "#6E6E6E" }}>
              {["AirDrop", "Harvest", "Messages"][i]}
            </Text>
          </Center>
        ))}
      </HStack>
    </OSCard>
  );
}

function ArtMore() {
  return (
    <OSCard>
      <HStack className="items-center justify-between">
        {(["mail", "logo-whatsapp", "chatbubble"] as const).map((icon, i) => (
          <Center key={i} className="h-12 w-12 rounded-2xl" style={{ backgroundColor: "#DDD3BE" }}>
            <Ionicons name={icon} size={20} color="#6E6E6E" />
          </Center>
        ))}
        <Center className="h-12 w-12 rounded-2xl" style={{ backgroundColor: "#EDE3CE", borderWidth: 3, borderColor: "#A85E2B" }}>
          <Ionicons name="ellipsis-horizontal" size={22} color="#A85E2B" />
        </Center>
      </HStack>
      <Text className="mt-3 text-center text-xs" style={{ color: "#6E6E6E" }}>
        Tap More
      </Text>
    </OSCard>
  );
}

function ArtEdit() {
  return (
    <OSCard>
      <HStack className="mb-3 items-center justify-between">
        <Text className="text-base font-bold" style={{ color: "#1c1c1e" }}>
          Apps
        </Text>
        <Center className="rounded-full px-3 py-1" style={{ backgroundColor: "#EDE3CE", borderWidth: 2, borderColor: "#A85E2B" }}>
          <Text className="text-sm font-semibold text-brand">Edit</Text>
        </Center>
      </HStack>
      {["Messages", "Mail", "Notes"].map((l) => (
        <HStack key={l} className="items-center py-2" space={10}>
          <View className="h-8 w-8 rounded-lg" style={{ backgroundColor: "#DDD3BE" }} />
          <Text style={{ color: "#1c1c1e" }}>{l}</Text>
        </HStack>
      ))}
    </OSCard>
  );
}

function ArtAdd() {
  return (
    <OSCard>
      <Text className="mb-2 text-xs font-semibold" style={{ color: "#8E8E93" }}>
        SUGGESTIONS
      </Text>
      <HStack className="items-center py-2" space={10}>
        <Center className="h-6 w-6 rounded-full bg-brand">
          <Ionicons name="add" size={16} color="#fff" />
        </Center>
        <HarvestTile />
        <Text className="flex-1 font-semibold" style={{ color: "#1c1c1e" }}>
          Harvest
        </Text>
      </HStack>
      {["Instagram", "Notes"].map((l) => (
        <HStack key={l} className="items-center py-2" space={10}>
          <Center className="h-6 w-6 rounded-full bg-brand">
            <Ionicons name="add" size={16} color="#fff" />
          </Center>
          <View className="h-8 w-8 rounded-lg" style={{ backgroundColor: "#DDD3BE" }} />
          <Text style={{ color: "#1c1c1e" }}>{l}</Text>
        </HStack>
      ))}
    </OSCard>
  );
}

function ArtDrag() {
  return (
    <OSCard>
      <Text className="mb-2 text-xs font-semibold" style={{ color: "#8E8E93" }}>
        FAVORITES
      </Text>
      <HStack className="items-center rounded-xl py-2" space={10} style={{ backgroundColor: "#F3E9D6" }}>
        <HarvestTile ring />
        <Text className="flex-1 font-semibold" style={{ color: "#1c1c1e" }}>
          Harvest
        </Text>
        <Ionicons name="reorder-three" size={22} color="#8E8E93" />
      </HStack>
      {["Messages", "Mail"].map((l) => (
        <HStack key={l} className="items-center py-2" space={10}>
          <View className="h-8 w-8 rounded-lg" style={{ backgroundColor: "#DDD3BE" }} />
          <Text className="flex-1" style={{ color: "#1c1c1e" }}>
            {l}
          </Text>
          <Ionicons name="reorder-three" size={22} color="#C7C7CC" />
        </HStack>
      ))}
    </OSCard>
  );
}

function ArtDone() {
  return (
    <Center className="h-56 w-64 rounded-3xl border border-hairline bg-card">
      <Center className="h-20 w-20 rounded-full bg-brand">
        <Ionicons name="checkmark" size={44} color="#fff" />
      </Center>
      <Text className="mt-4 text-lg font-bold text-ink">Shortcut ready</Text>
    </Center>
  );
}
