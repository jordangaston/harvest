import React from "react";
import { Modal, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Box, HStack, VStack, Text, Pressable, Icon, Radio, Button, ButtonText } from "../ui";

const BUCKETS = [
  { label: "Under 15 mins", value: 15 },
  { label: "Under 30 mins", value: 30 },
  { label: "Under 60 mins", value: 60 },
];

/** The total-time filter: pick one bucket (or clear). Applies a `maxMinutes` ceiling. */
export function TotalTimeSheet({
  visible,
  value,
  onApply,
  onClose,
}: {
  visible: boolean;
  value?: number;
  onApply: (maxMinutes?: number) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [pick, setPick] = React.useState<number | undefined>(value);

  // Reset to the applied value each open — one instance is reused across sheets.
  React.useEffect(() => {
    if (visible) setPick(value);
  }, [visible, value]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/30" onPress={onClose}>
        <View className="mt-auto">
          <Pressable onPress={() => {}}>
            <Box className="rounded-t-3xl bg-cream px-5 pt-4" style={{ paddingBottom: insets.bottom + 16 }}>
              <View className="mb-3 h-1.5 w-10 self-center rounded-full bg-hairline" />
              <HStack className="mb-3 items-center justify-between">
                <Text className="text-lg font-bold text-ink">Total time</Text>
                <Pressable onPress={onClose}>
                  <Icon name="close" size={22} color="#6E5B48" />
                </Pressable>
              </HStack>
              <VStack space={8}>
                {BUCKETS.map((b) => (
                  <Pressable
                    key={b.value}
                    onPress={() => setPick(b.value)}
                    className={`flex-row items-center justify-between rounded-2xl border px-4 py-3.5 ${
                      pick === b.value ? "border-brand bg-brand-light" : "border-hairline bg-card"
                    }`}
                  >
                    <Text className="text-base font-semibold text-ink">{b.label}</Text>
                    <Radio selected={pick === b.value} onSelect={() => setPick(b.value)} />
                  </Pressable>
                ))}
              </VStack>
              <HStack className="mt-4" space={12}>
                <Button action="light" className="flex-1" onPress={() => onApply(undefined)}>
                  <ButtonText className="text-ink">Clear</ButtonText>
                </Button>
                <Button className="flex-1" onPress={() => onApply(pick)}>
                  <ButtonText>Apply</ButtonText>
                </Button>
              </HStack>
            </Box>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}
