import React from "react";
import { View, LayoutAnimation, Platform, UIManager, AccessibilityInfo } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { VStack, HStack, Center, Text, Pressable, Icon } from "../ui";
import { DURATION } from "../../lib/motion";
import type { ChecklistState } from "../../lib/onboardingChecklist";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type Item = { key: keyof Omit<ChecklistState, "allDone">; label: string; icon: React.ComponentProps<typeof Ionicons>["name"]; onPress: () => void };

/**
 * The "Let's get cooking!" onboarding checklist, above the Cookbooks grid on the
 * recipes screen. Three items; a done item strikes through and stops being
 * tappable. Collapsible — defaults collapsed once all three are done. The
 * collapse uses a motion-token LayoutAnimation, skipped under Reduce Motion.
 */
export function OnboardingChecklist({
  state,
  onImport,
  onShortcut,
  onCreateCookbook,
}: {
  state: ChecklistState;
  onImport: () => void;
  onShortcut: () => void;
  onCreateCookbook: () => void;
}) {
  const [collapsed, setCollapsed] = React.useState(state.allDone);
  const reduceMotion = React.useRef(false);

  React.useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then((on) => (reduceMotion.current = on));
  }, []);

  // Collapse automatically the moment the last item completes.
  const wasAllDone = React.useRef(state.allDone);
  React.useEffect(() => {
    if (state.allDone && !wasAllDone.current) setCollapsed(true);
    wasAllDone.current = state.allDone;
  }, [state.allDone]);

  const toggle = () => {
    if (!reduceMotion.current) {
      const duration = collapsed ? DURATION.medium : DURATION.fast; // open slower than close
      LayoutAnimation.configureNext(LayoutAnimation.create(duration, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity));
    }
    setCollapsed((c) => !c);
  };

  const items: Item[] = [
    { key: "importFirst", label: "Import your first recipe", icon: "cloud-download-outline", onPress: onImport },
    { key: "unlockShortcut", label: "Unlock faster importing", icon: "flash-outline", onPress: onShortcut },
    { key: "createCookbook", label: "Create your first cookbook", icon: "book-outline", onPress: onCreateCookbook },
  ];

  return (
    <View className="mb-4 overflow-hidden rounded-3xl border border-hairline bg-cream">
      <Pressable onPress={toggle} className="flex-row items-center justify-between px-5 pt-4">
        <VStack>
          <Text className="text-sm text-muted">Welcome —</Text>
          <Text className="text-2xl font-bold text-ink">
            Let&apos;s get <Text className="text-2xl italic text-brand">cooking!</Text>
          </Text>
        </VStack>
        <Icon name={collapsed ? "chevron-down" : "chevron-up"} size={22} color="#6E5B48" />
      </Pressable>

      {collapsed ? null : (
        <VStack className="px-4 pb-4 pt-3" space={10}>
          {items.map((item) => {
            const done = state[item.key];
            return (
              <Pressable
                key={item.key}
                onPress={done ? undefined : item.onPress}
                disabled={done}
                className="flex-row items-center rounded-2xl border border-hairline bg-card px-4 py-3.5"
                style={done ? { opacity: 0.7 } : undefined}
              >
                {done ? (
                  <Center className="h-7 w-7 rounded-full bg-brand">
                    <Ionicons name="checkmark" size={16} color="#fff" />
                  </Center>
                ) : (
                  <Center className="h-7 w-7 rounded-full bg-brand-light">
                    <Ionicons name={item.icon} size={16} color="#A85E2B" />
                  </Center>
                )}
                <Text
                  className={`ml-3 flex-1 text-base font-semibold text-ink ${done ? "line-through" : ""}`}
                  style={done ? { color: "#8A7A63" } : undefined}
                >
                  {item.label}
                </Text>
                {done ? null : <Icon name="chevron-forward" size={20} color="#B8A88E" />}
              </Pressable>
            );
          })}
        </VStack>
      )}
    </View>
  );
}
