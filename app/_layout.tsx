import "../global.css";
import React from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Stack } from "expo-router";
import { LoadingScreen } from "../components/recime/LoadingScreen";
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

  if (!fontsLoaded || !minElapsed) {
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
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#F1E6D2" } }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="(onboarding)" />
          <Stack.Screen name="(app)" />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
