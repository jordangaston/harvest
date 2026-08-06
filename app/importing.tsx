import React from "react";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Backdrop } from "../components/recime/Backdrop";
import { CookingLoaderText } from "../components/recime/CookingLoaderText";
import { Center, Text, Button, ButtonText, Pressable } from "../components/ui";
import { runImport } from "../lib/api/imports";

type Phase = { kind: "loading"; progress: number } | { kind: "no_recipe" } | { kind: "failed" };

export default function Importing() {
  const router = useRouter();
  const { url } = useLocalSearchParams<{ url: string }>();
  const [phase, setPhase] = React.useState<Phase>({ kind: "loading", progress: 0 });

  React.useEffect(() => {
    let active = true;
    if (!url) {
      setPhase({ kind: "failed" });
      return;
    }
    runImport(url, (p) => {
      if (active) setPhase({ kind: "loading", progress: p });
    })
      .then((result) => {
        if (!active) return;
        if (result.status === "ready") router.replace(`/recipe/${result.recipeId}?mode=preview`);
        else setPhase({ kind: result.status === "no_recipe" ? "no_recipe" : "failed" });
      })
      .catch(() => {
        if (active) setPhase({ kind: "failed" });
      });
    return () => {
      active = false;
    };
  }, [url, router]);

  if (phase.kind === "loading") {
    return (
      <SafeAreaView className="flex-1 bg-cream" edges={["top", "bottom"]}>
        <Backdrop />
        <Center className="flex-1 px-8">
          <Image source={require("../assets/loader.webp")} contentFit="contain" style={{ width: 300, height: 456 }} />
          <CookingLoaderText size={30} />
          <Text className="mt-2 text-center text-base text-muted">
            {phase.progress > 0 ? `Importing your recipe · ${phase.progress}%` : "Importing your recipe…"}
          </Text>
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
