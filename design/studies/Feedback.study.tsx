import React from "react";
import { VStack, HStack, Center, Spinner, Icon, Divider, Text } from "../../components/ui";
import type { Study } from "../types.ts";

function FeedbackView({ iconSize }: { iconSize: number }) {
  return (
    <VStack space={20} className="w-full px-6">
      <HStack space={12} className="items-center">
        <Spinner />
        <Text className="text-ink">Loading…</Text>
      </HStack>

      <Divider />

      <HStack space={20} className="items-center">
        <Center>
          <Icon name="restaurant-outline" size={iconSize} />
          <Text className="text-xs text-muted">restaurant</Text>
        </Center>
        <Center>
          <Icon name="heart" size={iconSize} color="#A85E2B" />
          <Text className="text-xs text-muted">heart</Text>
        </Center>
        <Center>
          <Icon name="bookmark-outline" size={iconSize} />
          <Text className="text-xs text-muted">bookmark</Text>
        </Center>
      </HStack>

      <Divider />
    </VStack>
  );
}

export const FeedbackStudy: Study = {
  name: "Indicators",
  group: "Primitives",
  controls: [{ kind: "number", key: "iconSize", label: "Icon size", default: 28 }],
  render: ({ iconSize }) => <FeedbackView iconSize={Number(iconSize)} />,
};
