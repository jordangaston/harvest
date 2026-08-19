import React from "react";
import { Modal, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ScrollView, VStack, HStack, Text, Pressable, Icon } from "../ui";
import { ELEVATION } from "../../lib/elevation";
import { REASON_CHIPS, COMMON_INGREDIENTS, DislikeReason } from "./mock";

/**
 * The skippable dislike-reason chooser. The pass is already recorded (optimistic);
 * this only *upgrades* it with a reason that tunes the ranking. Dismissing leaves a
 * bare pass. "Don't like an ingredient" opens the ingredient picker for reason_detail.
 */
export function ReasonSheet({
  visible, onChoose, onSkip,
}: {
  visible: boolean;
  onChoose: (reason: DislikeReason, detail?: string) => void;
  onSkip: () => void;
}) {
  const [pickingIngredient, setPickingIngredient] = React.useState(false);

  // Reset the sub-step whenever the sheet reopens.
  React.useEffect(() => {
    if (visible) setPickingIngredient(false);
  }, [visible]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onSkip}>
      <View className="flex-1 justify-end" style={{ backgroundColor: "rgba(0,0,0,0.3)" }}>
        <View className="overflow-hidden rounded-t-3xl bg-cream" style={{ maxHeight: "80%" }}>
          <SafeAreaView edges={["bottom"]}>
            {pickingIngredient ? (
              <VStack space={16} className="px-5 pb-4 pt-5">
                <HStack className="items-center" space={10}>
                  <Pressable onPress={() => setPickingIngredient(false)} accessibilityLabel="Back to reasons" className="rounded-full bg-card p-2">
                    <Icon name="chevron-back" size={18} color="#2E2419" />
                  </Pressable>
                  <Text className="text-lg text-ink" style={{ fontFamily: "Karla_700Bold" }}>Which ingredient?</Text>
                </HStack>
                <ScrollView style={{ maxHeight: 320 }} contentContainerStyle={{ gap: 8 }}>
                  <View className="flex-row flex-wrap" style={{ gap: 8 }}>
                    {COMMON_INGREDIENTS.map((ing) => (
                      <Pressable
                        key={ing}
                        onPress={() => onChoose("disliked_ingredient", ing)}
                        accessibilityRole="button"
                        accessibilityLabel={`Avoid ${ing}`}
                        className="rounded-full bg-card px-4 py-2.5"
                        style={ELEVATION.low}
                      >
                        <Text className="text-base font-semibold text-ink">{ing}</Text>
                      </Pressable>
                    ))}
                  </View>
                </ScrollView>
              </VStack>
            ) : (
              <VStack space={14} className="px-5 pb-4 pt-5">
                <VStack space={4}>
                  <Text className="text-lg text-ink" style={{ fontFamily: "Karla_700Bold" }}>Not for you? Tell us why</Text>
                  <Text className="text-sm text-muted">Optional — it tunes what you see next. You can skip.</Text>
                </VStack>

                <View className="flex-row flex-wrap" style={{ gap: 8 }}>
                  {REASON_CHIPS.map((chip) => (
                    <Pressable
                      key={chip.reason}
                      onPress={() => (chip.reason === "disliked_ingredient" ? setPickingIngredient(true) : onChoose(chip.reason))}
                      accessibilityRole="button"
                      accessibilityLabel={chip.label}
                      className="flex-row items-center rounded-full bg-card px-4 py-2.5"
                      style={[{ gap: 6 }, ELEVATION.low]}
                    >
                      <Text className="text-base font-semibold text-ink">{chip.label}</Text>
                      {chip.reason === "disliked_ingredient" ? <Icon name="chevron-forward" size={15} color="#6E5B48" /> : null}
                    </Pressable>
                  ))}
                </View>

                <Pressable onPress={onSkip} accessibilityRole="button" accessibilityLabel="Skip — just pass" className="items-center py-2">
                  <Text className="text-base font-bold text-muted">Skip</Text>
                </Pressable>
              </VStack>
            )}
          </SafeAreaView>
        </View>
      </View>
    </Modal>
  );
}
