import React from "react";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Backdrop } from "../components/recime/Backdrop";
import { SAMPLE_RECIPE } from "../components/recime/recipes";
import { CookingLoaderText } from "../components/recime/CookingLoaderText";
import { Center, Text } from "../components/ui";

export default function Importing() {
  const router = useRouter();

  React.useEffect(() => {
    const done = setTimeout(() => router.replace(`/recipe/${SAMPLE_RECIPE.id}`), 2400);
    return () => clearTimeout(done);
  }, [router]);

  return (
    <SafeAreaView className="flex-1 bg-cream" edges={["top", "bottom"]}>
      <Backdrop />
      <Center className="flex-1 px-8">
        <Image
          source={require("../assets/loader.webp")}
          contentFit="contain"
          style={{ width: 300, height: 456 }}
        />
        <CookingLoaderText size={30} />
        <Text className="mt-2 text-center text-base text-muted">Importing your recipe</Text>
      </Center>
    </SafeAreaView>
  );
}
