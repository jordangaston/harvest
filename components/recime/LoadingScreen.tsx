import React from "react";
import { View, ImageBackground, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";

/**
 * App loading screen. Mirrors the Welcome hero (same image, scrim, and wordmark
 * position) so the app boots seamlessly into Welcome — only the CTA fades in.
 */
export function LoadingScreen() {
  return (
    <View className="flex-1 bg-ink">
      <ImageBackground
        source={require("../../assets/welcome-hero.jpg")}
        resizeMode="cover"
        style={{ flex: 1 }}
      >
        <LinearGradient
          colors={["rgba(46,36,25,0.62)", "rgba(46,36,25,0)"]}
          locations={[0, 1]}
          style={{ position: "absolute", left: 0, right: 0, top: 0, height: "42%" }}
        />
        <LinearGradient
          colors={["rgba(46,36,25,0)", "rgba(46,36,25,0.9)"]}
          locations={[0, 1]}
          style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: "38%" }}
        />

        <SafeAreaView className="flex-1" edges={["top", "bottom"]}>
          <View className="mt-auto items-center pb-14">
            <ActivityIndicator color="#FBF6EC" />
          </View>
        </SafeAreaView>
      </ImageBackground>
    </View>
  );
}
