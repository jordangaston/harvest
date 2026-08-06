import React from "react";
import { View, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Backdrop } from "../components/recime/Backdrop";
import { VStack, HStack, Text, Heading, Pressable, Input, Button, ButtonText, Icon } from "../components/ui";

export default function ImportRecipe() {
  const router = useRouter();
  const [url, setUrl] = React.useState("");
  const trimmed = url.trim();

  const start = (link: string) => {
    const clean = link.trim();
    if (!clean) return;
    router.replace(`/importing?url=${encodeURIComponent(clean)}`);
  };

  return (
    <SafeAreaView className="flex-1 bg-cream" edges={["top", "bottom"]}>
      <Backdrop />
      <HStack className="items-center justify-between px-5 pt-2">
        <Pressable onPress={() => router.back()} className="p-1">
          <Icon name="close" size={26} color="#2E2419" />
        </Pressable>
        <View className="w-8" />
      </HStack>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className="flex-1">
        <VStack className="px-6 pt-2" space={8}>
          <Heading className="text-2xl">Import a recipe</Heading>
          <Text className="text-base text-muted">
            Paste a link from the web, Instagram, TikTok, Pinterest, or YouTube — we&apos;ll pull in the ingredients and
            steps for you.
          </Text>

          <View className="mt-4">
            <Input
              value={url}
              onChangeText={setUrl}
              placeholder="Paste a recipe link"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              autoFocus
              returnKeyType="go"
              onSubmitEditing={() => start(url)}
            />
            <Text className="mt-2 text-xs text-muted">Long-press the field to paste, then tap Import.</Text>
          </View>

          <Button
            className="mt-4 w-full"
            onPress={() => start(url)}
            disabled={!trimmed}
            style={{ opacity: trimmed ? 1 : 0.5 }}
          >
            <ButtonText>Import</ButtonText>
          </Button>
        </VStack>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
