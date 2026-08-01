import React from "react";
import { StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Grain } from "./Grain";

/**
 * Full-screen backdrop: a subtle warm golden-hour gradient with the film grain
 * layered on top. Render as the FIRST child of a screen so it sits behind
 * everything else. Non-interactive.
 */
export function Backdrop() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
      <LinearGradient
        // bottom matches the navbar cream (#F1E6D2), lightening gently upward
        colors={["#F1E6D2", "#F4EBDB", "#F8F0E1"]}
        locations={[0, 0.5, 1]}
        start={{ x: 0.5, y: 1 }}
        end={{ x: 0.5, y: 0 }}
        style={StyleSheet.absoluteFillObject}
      />
      <Grain />
    </View>
  );
}
