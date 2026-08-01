import React from "react";
import { View, ImageBackground } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { VStack, Text, Button, ButtonText, Pressable } from "../../components/ui";

// Screen 1 — Welcome splash. Full-bleed golden-hour hero, branding at top, CTA at base.
export default function Welcome() {
  const router = useRouter();
  return (
    <View className="flex-1 bg-ink">
      <ImageBackground
        source={require("../../assets/welcome-hero.jpg")}
        resizeMode="cover"
        style={{ flex: 1 }}
      >
        {/* top scrim so branding reads over the wall */}
        <LinearGradient
          colors={["rgba(46,36,25,0.62)", "rgba(46,36,25,0)"]}
          locations={[0, 1]}
          style={{ position: "absolute", left: 0, right: 0, top: 0, height: "42%" }}
        />
        {/* bottom scrim for the CTA */}
        <LinearGradient
          colors={["rgba(46,36,25,0)", "rgba(46,36,25,0.9)"]}
          locations={[0, 1]}
          style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: "38%" }}
        />

        <SafeAreaView className="flex-1" edges={["top", "bottom"]}>
          {/* wordmark near the top */}
          <View className="items-center px-6 pt-16">
            <Text style={{ color: "#FBF6EC", fontFamily: "Lora_700Bold", fontSize: 54, lineHeight: 60 }}>
              Harvest
            </Text>
            <Text
              style={{ color: "#F3E9DA", fontSize: 19, lineHeight: 26, fontFamily: "Karla_700Bold" }}
              className="mt-4 text-center"
            >
              Import recipes, create shopping lists and meal plan like a pro
            </Text>
          </View>

          {/* CTA pinned to the bottom */}
          <VStack className="mt-auto px-6 pb-3" space={16}>
            <Button className="w-full" onPress={() => router.push("/(onboarding)/testimonials")}>
              <ButtonText>Get started</ButtonText>
            </Button>
            <Pressable
              className="flex-row justify-center"
              onPress={() => router.push("/(app)/recipes")}
            >
              <Text style={{ color: "#EADFCB" }}>Already have an account? </Text>
              <Text style={{ color: "#FBF6EC", fontFamily: "Karla_600SemiBold" }}>Log in</Text>
            </Pressable>
          </VStack>
        </SafeAreaView>
      </ImageBackground>
    </View>
  );
}
