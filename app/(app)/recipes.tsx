import React from "react";
import { View, ScrollView, Animated, AccessibilityInfo } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { Image } from "expo-image";
import { Backdrop } from "../../components/recime/Backdrop";
import { Logo } from "../../components/recime/Logo";
import { NewCookbookSheet } from "../../components/recime/NewCookbookSheet";
import { AddRecipeSheet } from "../../components/recime/AddRecipeSheet";
import { OnboardingChecklist } from "../../components/recime/OnboardingChecklist";
import { useCookbooks } from "../../lib/api/hooks";
import { useOnboardingFlags, checklistState } from "../../lib/onboardingChecklist";
import { takeSavedToast } from "../../lib/savedToast";
import { EASE, TOAST } from "../../lib/motion";
import { VStack, HStack, Center, Text, Pressable, Icon } from "../../components/ui";

export default function Recipes() {
  const router = useRouter();
  const [addOpen, setAddOpen] = React.useState(false);
  const [newCookbookOpen, setNewCookbookOpen] = React.useState(false);
  // Cached reads: a revisit inside the staleTime serves from cache; a mutation
  // (create cookbook, mark import) invalidates the key so the next mount refetches.
  const { data: cookbooks } = useCookbooks();
  const { data: flags } = useOnboardingFlags();
  const checklist = checklistState(flags ?? { importedFirst: false, shortcutDone: false }, cookbooks?.length ?? 0);
  const [toast, setToast] = React.useState<string | null>(null);
  const toastAnim = React.useRef(new Animated.Value(0)).current;
  const reduceMotion = React.useRef(false);

  React.useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then((on) => (reduceMotion.current = on));
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", (on) => (reduceMotion.current = on));
    return () => sub.remove();
  }, []);

  // On focus, show a brief toast if a save just happened (read-once, so it never
  // re-fires on a later focus). Cookbook data comes from the cache above.
  useFocusEffect(
    React.useCallback(() => {
      const saved = takeSavedToast();
      if (saved) setToast(saved);
    }, []),
  );

  // Rise the toast in (slower), hold, then drop it out (quicker) before clearing —
  // opens are an invitation, closes get out of the way. Instant when Reduce Motion is on.
  React.useEffect(() => {
    if (!toast) return;
    const rm = reduceMotion.current;
    toastAnim.setValue(rm ? 1 : 0);
    // JS driver (not native): a freshly-mounted view's native node isn't ready when
    // start() fires, so a native-driven entrance silently stalls at opacity 0.
    Animated.timing(toastAnim, {
      toValue: 1,
      duration: rm ? 0 : TOAST.inMs,
      easing: EASE.smoothOut,
      useNativeDriver: false,
    }).start();
    const hold = setTimeout(() => {
      Animated.timing(toastAnim, {
        toValue: 0,
        duration: rm ? 0 : TOAST.outMs,
        easing: EASE.smoothOut,
        useNativeDriver: false,
      }).start(({ finished }) => finished && setToast(null));
    }, 2200);
    return () => clearTimeout(hold);
  }, [toast, toastAnim]);

  return (
    <SafeAreaView className="flex-1 bg-cream" edges={["top"]}>
      <Backdrop />
      <HStack className="items-center justify-between px-5 pt-2">
        <Logo size={22} />
        <View className="h-8 w-8 rounded-full bg-sand" />
      </HStack>

      <View className="mt-3 flex-row items-center px-5">
        <Text className="text-2xl font-bold text-ink">Cookbooks</Text>
        <View className="ml-1">
          <Icon name="chevron-down" size={20} color="#2E2419" />
        </View>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16, paddingBottom: 110 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Onboarding checklist replaces the old empty-state art; it sits above the
            grid and collapses once all three items are done. */}
        <OnboardingChecklist
          state={checklist}
          onImport={() => setAddOpen(true)}
          onShortcut={() => router.push("/unlock-importing")}
          onCreateCookbook={() => setNewCookbookOpen(true)}
        />

        <View className="flex-row flex-wrap justify-between">
          {(cookbooks ?? []).map((cb) => (
            <Pressable
              key={cb.id}
              onPress={() => router.push(`/cookbook/${cb.id}`)}
              className="mb-4 overflow-hidden rounded-2xl border border-hairline bg-card"
              style={{ width: "48%" }}
            >
              {cb.cover_image_url ? (
                <Image source={{ uri: cb.cover_image_url }} contentFit="cover" style={{ width: "100%", height: 110 }} transition={200} />
              ) : (
                <Center className="bg-brand-light" style={{ width: "100%", height: 110 }}>
                  <Icon name="book-outline" size={28} color="#A85E2B" />
                </Center>
              )}
              <VStack className="px-3 py-3">
                <Text className="text-base font-bold text-ink" numberOfLines={1}>
                  {cb.name}
                </Text>
                <Text className="text-xs text-muted">
                  {cb.recipe_count} {cb.recipe_count === 1 ? "recipe" : "recipes"}
                </Text>
              </VStack>
            </Pressable>
          ))}
        </View>
      </ScrollView>

      <Pressable
        className="absolute bottom-6 right-6 h-14 w-14 items-center justify-center rounded-full bg-brand shadow-lg"
        onPress={() => setAddOpen(true)}
      >
        <Icon name="add" size={30} color="#fff" />
      </Pressable>

      <AddRecipeSheet visible={addOpen} onClose={() => setAddOpen(false)} onNewCookbook={() => setNewCookbookOpen(true)} />
      <NewCookbookSheet visible={newCookbookOpen} onClose={() => setNewCookbookOpen(false)} />

      {toast ? (
        <Animated.View
          pointerEvents="none"
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 96,
            alignItems: "center",
            opacity: toastAnim,
            transform: [{ translateY: toastAnim.interpolate({ inputRange: [0, 1], outputRange: [TOAST.rise, 0] }) }],
          }}
        >
          <HStack className="items-center rounded-full bg-ink px-4 py-2.5 shadow-lg" space={8}>
            <Icon name="checkmark-circle" size={18} color="#F1E6D2" />
            <Text className="font-semibold" style={{ color: "#F1E6D2" }}>Saved to {toast}</Text>
          </HStack>
        </Animated.View>
      ) : null}
    </SafeAreaView>
  );
}
