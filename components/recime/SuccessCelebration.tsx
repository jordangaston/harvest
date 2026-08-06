import React from "react";
import { Modal } from "react-native";
import { Box, Center, Text, Button, ButtonText, Pressable, Icon } from "../ui";

/**
 * The "Now you're cooking!" celebration shown after a recipe is saved into a
 * cookbook (mirrors Recime's confetti moment, in golden-hour tokens).
 */
export function SuccessCelebration({
  visible,
  onView,
  onSaveAnother,
}: {
  visible: boolean;
  onView: () => void;
  onSaveAnother: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade">
      <Center className="flex-1 bg-black/40 px-8">
        <Box className="w-full items-center rounded-3xl bg-card px-6 py-8">
          <Center className="mb-4 h-20 w-20 rounded-full bg-brand-light">
            <Icon name="checkmark" size={44} color="#A85E2B" />
          </Center>
          <Text className="text-center text-xl text-ink">Now you&apos;re</Text>
          <Text className="mb-5 text-center text-4xl italic text-brand">cooking!</Text>
          <Button className="w-full" onPress={onView}>
            <ButtonText>View recipe</ButtonText>
          </Button>
          <Pressable className="mt-3 py-1" onPress={onSaveAnother}>
            <Text className="font-semibold text-brand-dark">Save another recipe</Text>
          </Pressable>
        </Box>
      </Center>
    </Modal>
  );
}
