import React from "react";
import { Modal, View, KeyboardAvoidingView, Platform } from "react-native";
import { Box, HStack, Text, Pressable, Input, Button, ButtonText, Icon } from "../ui";
import { createCookbook } from "../../lib/api/cookbooks";
import { ApiError } from "../../lib/api/client";
import type { ApiCookbook } from "../../lib/api/types";

/**
 * Bottom-sheet form to create a named cookbook. Enforces a non-empty name
 * (inline) and surfaces a friendly message on a name collision (409). Shared by
 * the Recipes "+" menu and the save-to-cookbook flow.
 */
export function NewCookbookSheet({
  visible,
  onClose,
  onCreated,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated?: (cookbook: ApiCookbook) => void;
}) {
  const [name, setName] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const trimmed = name.trim();

  const reset = () => {
    setName("");
    setError(null);
    setBusy(false);
  };

  const submit = async () => {
    if (!trimmed) {
      setError("Give your cookbook a name.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const cookbook = await createCookbook(trimmed);
      reset();
      onCreated?.(cookbook);
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.code === "COOKBOOK_EXISTS") {
        setError(`You already have a cookbook called “${trimmed}”.`);
      } else {
        setError("Couldn't create that cookbook. Try again.");
      }
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        className="flex-1 bg-black/30"
        onPress={() => {
          reset();
          onClose();
        }}
      >
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className="flex-1 justify-end">
          <Pressable onPress={() => {}}>
            <Box className="rounded-t-3xl bg-card px-5 pb-10 pt-4">
              <View className="mb-4 h-1.5 w-10 self-center rounded-full bg-hairline" />
              <HStack className="mb-4 items-center justify-between">
                <Text className="text-xl font-bold text-ink">New cookbook</Text>
                <Pressable
                  onPress={() => {
                    reset();
                    onClose();
                  }}
                >
                  <Icon name="close" size={22} color="#6E5B48" />
                </Pressable>
              </HStack>
              <Text className="mb-2 text-sm font-semibold text-muted">Title</Text>
              <Input
                value={name}
                onChangeText={(t) => {
                  setName(t.slice(0, 50));
                  setError(null);
                }}
                placeholder="e.g. Weeknight Dinner"
                autoFocus
                maxLength={50}
                returnKeyType="done"
                onSubmitEditing={submit}
              />
              <HStack className="mt-1.5 items-center justify-between">
                <Text className="flex-1 text-xs text-error">{error ?? ""}</Text>
                <Text className="text-xs text-muted">{trimmed.length}/50</Text>
              </HStack>
              <Button
                className="mt-4 w-full"
                onPress={submit}
                disabled={!trimmed || busy}
                style={{ opacity: !trimmed || busy ? 0.5 : 1 }}
              >
                <ButtonText>{busy ? "Creating…" : "Create cookbook"}</ButtonText>
              </Button>
            </Box>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}
