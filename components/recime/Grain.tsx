import React from "react";
import { View, Image, StyleSheet } from "react-native";

const grain = require("../../assets/grain.png");

/**
 * Subtle film-grain background layer for the vintage golden-hour feel.
 * Render as the FIRST child of a screen so it sits behind content.
 * Non-interactive; covers the full viewport (no tiling seams).
 */
export function Grain({ opacity = 0.07 }: { opacity?: number }) {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
      <Image
        source={grain}
        resizeMode="cover"
        style={[StyleSheet.absoluteFillObject, { opacity, width: "100%", height: "100%" }]}
      />
    </View>
  );
}
