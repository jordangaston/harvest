import React from "react";
import { View, Modal, AccessibilityInfo } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Image } from "expo-image";
import { useQueryClient } from "@tanstack/react-query";
import { Backdrop } from "../components/recime/Backdrop";
import { Text, Pressable, Button, ButtonText, Icon, Center, VStack } from "../components/ui";
import { useMe, useDeleteAccount } from "../lib/api/hooks";
import { clearSession } from "../lib/api/session";

export default function Profile() {
  const router = useRouter();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const del = useDeleteAccount();

  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [reduceMotion, setReduceMotion] = React.useState(false);

  React.useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
  }, []);

  // Leave to the welcome screen, then tear down the session and cache. Navigate
  // FIRST so the protected screens unmount before we clear anything — a stray
  // refetch after the token is gone would re-provision a new user via apiFetch.
  const leaveToWelcome = React.useCallback(async () => {
    router.replace("/(onboarding)/welcome");
    await clearSession();
    qc.clear();
  }, [router, qc]);

  const onDelete = () => {
    setError(null);
    del.mutate(undefined, {
      onSuccess: () => leaveToWelcome(),
      // Keep the session — never strand the user logged-out with their data intact.
      onError: () => setError("Couldn't delete your account. Please try again."),
    });
  };

  const name = me?.name?.trim();

  return (
    <SafeAreaView className="flex-1 bg-cream" edges={["top"]}>
      <Backdrop />

      <View className="flex-row items-center px-5 pt-2">
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" className="h-9 w-9 items-center justify-center">
          <Icon name="chevron-back" size={26} color="#2E2419" />
        </Pressable>
        <Text className="ml-1 text-2xl font-bold text-ink">Profile</Text>
      </View>

      <Center className="mt-8 px-6">
        <View className="h-28 w-28 overflow-hidden rounded-full border border-hairline bg-sand">
          <Image source={require("../assets/default-avatar.png")} contentFit="cover" style={{ width: "100%", height: "100%" }} />
        </View>
        <Text className="mt-4 text-2xl font-bold text-ink">{name || "Welcome"}</Text>
      </Center>

      <VStack space={12} className="mt-10 px-5">
        <Pressable
          onPress={leaveToWelcome}
          accessibilityRole="button"
          className="h-14 flex-row items-center justify-center rounded-full border border-hairline bg-card"
        >
          <Text className="text-base font-bold text-ink">Log out</Text>
        </Pressable>

        <Pressable
          onPress={() => setConfirmOpen(true)}
          accessibilityRole="button"
          className="h-14 flex-row items-center justify-center rounded-full"
        >
          <Text className="text-base font-bold text-error">Delete account</Text>
        </Pressable>
      </VStack>

      <Modal
        visible={confirmOpen}
        transparent
        animationType={reduceMotion ? "none" : "slide"}
        onRequestClose={() => setConfirmOpen(false)}
      >
        <View className="flex-1 justify-end bg-black/30">
          <VStack className="rounded-t-3xl bg-cream px-6 pb-10 pt-6" space={8}>
            <Text className="text-xl font-bold text-ink">Delete your account?</Text>
            <Text className="text-muted">
              This permanently deletes your recipes, cookbooks, meal plans, and grocery list. This can&apos;t be undone.
            </Text>
            {error ? <Text className="text-error">{error}</Text> : null}

            <Pressable
              onPress={() => setConfirmOpen(false)}
              disabled={del.isPending}
              accessibilityRole="button"
              className="mt-2 h-14 flex-row items-center justify-center rounded-full border border-hairline bg-card"
            >
              <Text className="text-base font-bold text-ink">Cancel</Text>
            </Pressable>

            <Button action="error" onPress={onDelete} disabled={del.isPending} accessibilityRole="button">
              <ButtonText>{del.isPending ? "Deleting…" : "Delete"}</ButtonText>
            </Button>
          </VStack>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
