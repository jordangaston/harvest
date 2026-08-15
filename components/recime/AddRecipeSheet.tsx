import React from "react";
import { Modal, View, Animated, Dimensions, AccessibilityInfo } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Box, VStack, HStack, Text, Pressable, Icon } from "../ui";
import { DURATION, EASE } from "../../lib/motion";
import { SOCIAL_PLATFORMS, PLATFORM_ICON, type SocialPlatform } from "../../lib/sampleRecipes";

const PLATFORM_TINT: Record<SocialPlatform, string> = {
  Pinterest: "#E60023",
  TikTok: "#2E2419",
  Instagram: "#E4405F",
  YouTube: "#FF0000",
};

/**
 * The single "add" entry point for the recipes screen — reached from the "+" FAB
 * and the onboarding checklist's "Import your first recipe". Replaces the old
 * inline FAB menu. Two in-sheet stages: root (social / web / new cookbook) and a
 * social stage listing the four platforms. The stage slide honors the motion
 * tokens and is skipped under Reduce Motion.
 */
export function AddRecipeSheet({
  visible,
  onClose,
  onNewCookbook,
}: {
  visible: boolean;
  onClose: () => void;
  onNewCookbook: () => void;
}) {
  const router = useRouter();
  const width = Dimensions.get("window").width;
  const [stage, setStage] = React.useState<"root" | "social">("root");
  const slide = React.useRef(new Animated.Value(0)).current; // 0 root · 1 social
  const reduceMotion = React.useRef(false);

  React.useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then((on) => (reduceMotion.current = on));
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", (on) => (reduceMotion.current = on));
    return () => sub.remove();
  }, []);

  // Reset to the root stage whenever the sheet (re)opens.
  React.useEffect(() => {
    if (visible) {
      setStage("root");
      slide.setValue(0);
    }
  }, [visible, slide]);

  const goTo = (next: "root" | "social") => {
    setStage(next);
    const toValue = next === "social" ? 1 : 0;
    if (reduceMotion.current) {
      slide.setValue(toValue);
      return;
    }
    Animated.timing(slide, {
      toValue,
      duration: next === "social" ? DURATION.medium : DURATION.fast, // open slower than back
      easing: EASE.smoothOut,
      useNativeDriver: true,
    }).start();
  };

  const close = () => {
    onClose();
  };

  const pickPlatform = (p: SocialPlatform) => {
    close();
    router.push(`/import-source?source=${p}`);
  };

  const translateX = slide.interpolate({ inputRange: [0, 1], outputRange: [0, -width] });

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <Pressable className="flex-1 bg-black/30" onPress={close}>
        <View className="mt-auto">
          <Pressable onPress={() => {}}>
            <Box className="overflow-hidden rounded-t-3xl bg-cream px-5 pb-10 pt-4">
              <View className="mb-4 h-1.5 w-10 self-center rounded-full bg-hairline" />

              <Animated.View style={{ flexDirection: "row", width: width * 2, transform: [{ translateX }] }}>
                {/* ---- root stage ---- */}
                <View style={{ width }} className="pr-10">
                  <Text className="mb-4 text-xl font-bold text-ink">Add a recipe</Text>
                  <VStack space={12}>
                    <Pressable
                      onPress={() => goTo("social")}
                      className="flex-row items-center rounded-2xl bg-brand px-4 py-4"
                    >
                      <Ionicons name="share-social" size={22} color="#fff" />
                      <VStack className="ml-3 flex-1">
                        <Text className="text-base font-semibold text-white">Import from social media</Text>
                        <Text className="text-sm" style={{ color: "#F6E9DC" }}>
                          Pinterest, TikTok, Instagram or YouTube
                        </Text>
                      </VStack>
                      <Icon name="chevron-forward" size={20} color="#F6E9DC" />
                    </Pressable>

                    <Pressable
                      onPress={() => {
                        close();
                        router.push("/import");
                      }}
                      className="flex-row items-center rounded-2xl border border-hairline bg-card px-4 py-4"
                    >
                      <Ionicons name="link" size={20} color="#A85E2B" />
                      <VStack className="ml-3 flex-1">
                        <Text className="text-base font-semibold text-ink">Import from web</Text>
                        <Text className="text-sm text-muted">Paste a recipe link</Text>
                      </VStack>
                      <Icon name="chevron-forward" size={20} color="#B8A88E" />
                    </Pressable>

                    <Pressable
                      onPress={() => {
                        close();
                        onNewCookbook();
                      }}
                      className="flex-row items-center rounded-2xl border border-hairline bg-card px-4 py-4"
                    >
                      <Ionicons name="book-outline" size={20} color="#A85E2B" />
                      <Text className="ml-3 flex-1 text-base font-semibold text-ink">New cookbook</Text>
                      <Icon name="chevron-forward" size={20} color="#B8A88E" />
                    </Pressable>
                  </VStack>
                </View>

                {/* ---- social stage ---- */}
                <View style={{ width }} className="pr-10">
                  <HStack className="mb-4 items-center" space={8}>
                    <Pressable onPress={() => goTo("root")} className="p-1" hitSlop={10}>
                      <Icon name="chevron-back" size={22} color="#2E2419" />
                    </Pressable>
                    <Text className="text-xl font-bold text-ink">Import from social media</Text>
                  </HStack>
                  <VStack space={10}>
                    {SOCIAL_PLATFORMS.map((p) => (
                      <Pressable
                        key={p}
                        onPress={() => pickPlatform(p)}
                        className="flex-row items-center rounded-2xl border border-hairline bg-card px-4 py-3.5"
                      >
                        <Ionicons name={PLATFORM_ICON[p]} size={24} color={PLATFORM_TINT[p]} />
                        <Text className="ml-3 flex-1 text-base font-semibold text-ink">{p}</Text>
                        <Icon name="chevron-forward" size={20} color="#B8A88E" />
                      </Pressable>
                    ))}
                  </VStack>
                </View>
              </Animated.View>
            </Box>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}
