import React from "react";
import { Text } from "../ui";

/** Harvest wordmark — the Lora "Harvest" logotype. */
export function Logo({ size = 20, color = "#8A4A1E" }: { size?: number; color?: string }) {
  return (
    <Text style={{ fontSize: size, color, fontFamily: "Lora_700Bold" }} className="tracking-tight">
      Harvest
    </Text>
  );
}
