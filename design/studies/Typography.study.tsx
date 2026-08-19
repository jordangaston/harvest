import React from "react";
import { VStack, Heading, Text } from "../../components/ui";
import type { Study } from "../types.ts";

function TypographyView({ sample }: { sample: string }) {
  return (
    <VStack space={16} className="w-full px-6">
      <Heading className="text-3xl">{sample}</Heading>
      <Heading className="text-2xl">{sample}</Heading>
      <Text className="text-xl font-bold">{sample}</Text>
      <Text className="text-base">{sample}</Text>
      <Text className="text-sm text-muted">{sample}</Text>
      <Text className="text-xs uppercase tracking-widest text-muted">{sample}</Text>
    </VStack>
  );
}

export const TypographyStudy: Study = {
  name: "Typography",
  group: "Primitives",
  controls: [
    { kind: "text", key: "sample", label: "Sample", default: "Golden hour harvest" },
  ],
  render: ({ sample }) => <TypographyView sample={String(sample)} />,
};
