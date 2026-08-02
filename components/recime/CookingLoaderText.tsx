import React from "react";
import { View, Text } from "react-native";

// Themed cooking verbs shown while a recipe imports — cycled in random order,
// à la Anthropic's playful status verbs.
const VERBS = [
  "Simmering",
  "Braising",
  "Boiling",
  "Blanching",
  "Flambéing",
  "Searing",
  "Sautéing",
  "Whisking",
  "Folding",
  "Reducing",
  "Poaching",
  "Caramelizing",
  "Roasting",
  "Basting",
  "Kneading",
  "Marinating",
  "Deglazing",
  "Zesting",
  "Seasoning",
  "Steaming",
  "Glazing",
  "Proofing",
];

function shuffled(): string[] {
  const a = [...VERBS];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Cycling themed cooking verb in Lora with animated trailing dots. */
export function CookingLoaderText({ size = 22, color = "#2E2419" }: { size?: number; color?: string }) {
  const order = React.useRef(shuffled());
  const [i, setI] = React.useState(0);
  const [dots, setDots] = React.useState(3);

  React.useEffect(() => {
    const v = setInterval(() => setI((n) => (n + 1) % order.current.length), 1500);
    const d = setInterval(() => setDots((n) => (n % 3) + 1), 420);
    return () => {
      clearInterval(v);
      clearInterval(d);
    };
  }, []);

  const style = { fontFamily: "Lora_600SemiBold", fontSize: size, color, lineHeight: size * 1.2 } as const;

  return (
    <View style={{ flexDirection: "row", justifyContent: "center" }}>
      <Text style={style}>{order.current[i]}</Text>
      {/* fixed-width dot box so the line never reflows as dots animate */}
      <View style={{ width: size * 0.95 }}>
        <Text style={style}>{".".repeat(dots)}</Text>
      </View>
    </View>
  );
}
