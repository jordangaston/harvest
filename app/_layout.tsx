import "../global.css";
import React from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Stack } from "expo-router";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { LoadingScreen } from "../components/recime/LoadingScreen";
import { ScreenTracker } from "../components/recime/ScreenTracker";
import { queryClient, persistOptions } from "../lib/queryClient";
import { getSession } from "../lib/api/session";
import { initAnalytics } from "../lib/analytics";
import {
  useFonts,
  Karla_400Regular,
  Karla_500Medium,
  Karla_600SemiBold,
  Karla_700Bold,
  Karla_800ExtraBold,
} from "@expo-google-fonts/karla";
import { Lora_600SemiBold, Lora_700Bold } from "@expo-google-fonts/lora";

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Karla_400Regular,
    Karla_500Medium,
    Karla_600SemiBold,
    Karla_700Bold,
    Karla_800ExtraBold,
    Lora_600SemiBold,
    Lora_700Bold,
  });

  // hold the splash a minimum time so it reads as intentional, not a flicker
  const [minElapsed, setMinElapsed] = React.useState(false);
  React.useEffect(() => {
    const t = setTimeout(() => setMinElapsed(true), 1400);
    return () => clearTimeout(t);
  }, []);

  // Restore an existing session before the app renders — but do NOT provision a
  // new user here: the account is created at the end of onboarding so its signup
  // POST carries the onboarding payload (C2). A failure doesn't block the UI.
  const [sessionReady, setSessionReady] = React.useState(false);
  React.useEffect(() => {
    getSession()
      .catch(() => {})
      .finally(() => setSessionReady(true));
  }, []);

  // Wire the analytics backend once. No-op unless a Mixpanel token is configured (decision #5).
  React.useEffect(() => {
    initAnalytics();
  }, []);

  if (!fontsLoaded || !minElapsed || !sessionReady) {
    return (
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <StatusBar style="light" />
          <LoadingScreen />
        </SafeAreaProvider>
      </GestureHandlerRootView>
    );
  }

  return (
    <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <StatusBar style="dark" />
          <ScreenTracker />
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#F1E6D2" } }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="(onboarding)" />
            <Stack.Screen name="(app)" />
            <Stack.Screen name="import" options={{ animation: "slide_from_bottom" }} />
            <Stack.Screen name="import-source" options={{ animation: "slide_from_bottom" }} />
            <Stack.Screen name="importing" options={{ animation: "fade" }} />
          </Stack>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </PersistQueryClientProvider>
  );
}
