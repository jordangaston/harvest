import React from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { ScrollView, View } from "react-native";
import { usePathname } from "expo-router";
import { ProgressHeader } from "./ProgressHeader";
import { Logo } from "./Logo";
import { Backdrop } from "./Backdrop";
import { Button, ButtonText } from "../ui";
import { analytics } from "../../lib/analytics";

/**
 * Shared onboarding shell: cream background, optional Logo + progress header,
 * scrollable body, and a pinned bottom CTA. Matches the Harvest onboarding chrome.
 */
export function OnboardingScreen({
  children,
  progress,
  showHeader = true,
  showLogo = true,
  showBack = true,
  onBack,
  onSkip,
  ctaLabel,
  onCta,
  ctaAction = "brand",
  ctaDisabled = false,
  footer,
  contentClassName = "",
}: {
  children: React.ReactNode;
  progress?: number;
  showHeader?: boolean;
  showLogo?: boolean;
  showBack?: boolean;
  onBack?: () => void;
  onSkip?: () => void;
  ctaLabel?: string;
  onCta?: () => void;
  ctaAction?: "brand" | "plus" | "dark";
  ctaDisabled?: boolean;
  footer?: React.ReactNode;
  contentClassName?: string;
}) {
  const pathname = usePathname();
  // Advancing a screen via its CTA is the "continue past onboarding" signal; the route names the step.
  const handleCta = onCta
    ? () => {
        analytics.track("Onboarding Step Completed", { step: pathname });
        onCta();
      }
    : undefined;
  return (
    <SafeAreaView className="flex-1 bg-cream" edges={["top", "bottom"]}>
      <Backdrop />
      {showLogo ? (
        <View className="items-center pt-2 pb-1">
          <Logo />
        </View>
      ) : null}
      {showHeader ? (
        <ProgressHeader progress={progress} onSkip={onSkip} showBack={showBack} onBack={onBack} />
      ) : null}

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 16, paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
      >
        <View className={contentClassName}>{children}</View>
      </ScrollView>

      {ctaLabel || footer ? (
        <View className="px-6 pb-2 pt-2">
          {footer}
          {ctaLabel ? (
            <Button
              action={ctaAction}
              className="w-full"
              disabled={ctaDisabled}
              style={ctaDisabled ? { opacity: 0.4 } : undefined}
              onPress={handleCta}
            >
              <ButtonText>{ctaLabel}</ButtonText>
            </Button>
          ) : null}
        </View>
      ) : null}
    </SafeAreaView>
  );
}
