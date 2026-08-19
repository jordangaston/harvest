import React from "react";
import { VStack, HStack, Button, ButtonText, Pressable, Text } from "../../components/ui";
import type { Study } from "../types.ts";

type Action = "brand" | "plus" | "dark" | "light" | "error";

function ButtonsView({ label, action }: { label: string; action: Action }) {
  return (
    <VStack space={20} className="w-full px-6">
      <VStack space={10}>
        <Text className="text-sm text-muted">Variants ({action})</Text>
        <HStack space={12} className="flex-wrap items-center">
          <Button action={action} variant="solid">
            <ButtonText>{label}</ButtonText>
          </Button>
          <Button action={action} variant="outline">
            <ButtonText className="text-ink">{label}</ButtonText>
          </Button>
          <Button action={action} variant="link">
            <ButtonText className="text-brand">{label}</ButtonText>
          </Button>
        </HStack>
      </VStack>

      <VStack space={10}>
        <Text className="text-sm text-muted">Sizes</Text>
        <HStack space={12} className="flex-wrap items-center">
          <Button action={action} size="lg">
            <ButtonText>Large</ButtonText>
          </Button>
          <Button action={action} size="md">
            <ButtonText>Medium</ButtonText>
          </Button>
          <Button action={action} size="sm">
            <ButtonText>Small</ButtonText>
          </Button>
        </HStack>
      </VStack>

      <VStack space={10}>
        <Text className="text-sm text-muted">Bare Pressable</Text>
        <Pressable className="self-start rounded-full bg-card border border-hairline px-5 py-3">
          <Text className="text-ink">{label}</Text>
        </Pressable>
      </VStack>
    </VStack>
  );
}

export const ButtonsStudy: Study = {
  name: "Buttons",
  group: "Primitives",
  controls: [
    { kind: "text", key: "label", label: "Label", default: "Save recipe" },
    {
      kind: "enum",
      key: "action",
      label: "Action",
      options: ["brand", "plus", "dark", "light", "error"],
      default: "brand",
    },
  ],
  render: ({ label, action }) => (
    <ButtonsView label={String(label)} action={String(action) as Action} />
  ),
};
