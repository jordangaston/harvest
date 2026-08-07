import React from "react";
import { View } from "react-native";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Backdrop } from "../components/recime/Backdrop";
import { CookingLoaderText } from "../components/recime/CookingLoaderText";
import { Center, Text, Button, ButtonText, Pressable } from "../components/ui";
import { runImport } from "../lib/api/imports";

type Phase = { kind: "loading" } | { kind: "no_recipe" } | { kind: "failed" };

// The bar eases toward this ceiling while running so it always visibly moves,
// even though the server reports coarse progress (it doesn't reach 100 until ready).
const PROGRESS_CEILING = 92;

export default function Importing() {
  const router = useRouter();
  const { url } = useLocalSearchParams<{ url: string }>();
  const [phase, setPhase] = React.useState<Phase>({ kind: "loading" });
  const [displayed, setDisplayed] = React.useState(6);
  const serverProgress = React.useRef(0);

  // Ease the displayed progress upward (asymptotic toward the ceiling), using the
  // server's coarse progress as a floor — so the bar never sits stuck.
  React.useEffect(() => {
    if (phase.kind !== "loading") return;
    const t = setInterval(() => {
      setDisplayed((d) => Math.max(d + (PROGRESS_CEILING - d) * 0.06, serverProgress.current));
    }, 350);
    return () => clearInterval(t);
  }, [phase.kind]);

  React.useEffect(() => {
    let active = true;
    if (!url) {
      setPhase({ kind: "failed" });
      return;
    }
    runImport(url, (p) => {
      serverProgress.current = p;
    })
      .then((result) => {
        if (!active) return;
        if (result.status === "ready") {
          const ids = result.recipeIds;
          if (ids.length > 1) router.replace(`/preview?ids=${ids.join(",")}`);
          else router.replace(`/recipe/${ids[0]}?mode=preview`);
        } else {
          setPhase({ kind: result.status === "no_recipe" ? "no_recipe" : "failed" });
        }
      })
      .catch(() => {
        if (active) setPhase({ kind: "failed" });
      });
    return () => {
      active = false;
    };
  }, [url, router]);

  if (phase.kind === "loading") {
    const pct = Math.round(displayed);
    return (
      <SafeAreaView className="flex-1 bg-cream" edges={["top", "bottom"]}>
        <Backdrop />
        <Center className="flex-1 px-8">
          <Image source={require("../assets/loader.webp")} contentFit="contain" style={{ width: 300, height: 456 }} />
          <CookingLoaderText size={30} />
          <Text className="mt-2 text-center text-base text-muted">Importing your recipe</Text>
          {/* eased progress bar */}
          <View className="mt-4 h-2 w-56 overflow-hidden rounded-full bg-sand">
            <View className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
          </View>
          <Text className="mt-1.5 text-xs text-muted">{pct}%</Text>
        </Center>
      </SafeAreaView>
    );
  }

  const message = phase.kind === "no_recipe" ? "We don't think this contains a recipe" : "Oops let's try that again";
  const emoji = phase.kind === "no_recipe" ? "🤔" : "😅";

  return (
    <SafeAreaView className="flex-1 bg-cream" edges={["top", "bottom"]}>
      <Backdrop />
      <Center className="flex-1 px-10">
        <Text className="mb-3 text-6xl">{emoji}</Text>
        <Text className="mb-7 text-center text-xl font-bold text-ink">{message}</Text>
        <Button className="w-full" onPress={() => router.replace("/import")}>
          <ButtonText>Try again</ButtonText>
        </Button>
        <Pressable className="mt-3 py-1" onPress={() => router.replace("/(app)/recipes")}>
          <Text className="font-semibold text-brand-dark">Back to recipes</Text>
        </Pressable>
      </Center>
    </SafeAreaView>
  );
}
