import React from "react";
import { IngredientFilterSheet } from "../../components/recime/IngredientFilterSheet";
import { Pressable, Text, Center } from "../../components/ui";
import type { Study } from "../types.ts";

function IngredientFilterSheetStudyView() {
  const [open, setOpen] = React.useState(true);
  return (
    <Center className="flex-1">
      <Pressable onPress={() => setOpen(true)} className="rounded-full border border-brand bg-brand-light px-4 py-2">
        <Text className="font-bold text-brand">Open sheet</Text>
      </Pressable>
      <IngredientFilterSheet
        visible={open}
        selected={[]}
        onApply={() => {}}
        onClose={() => setOpen(false)}
      />
    </Center>
  );
}

export const IngredientFilterSheetStudy: Study = {
  name: "IngredientFilterSheet",
  group: "Sheets",
  render: () => <IngredientFilterSheetStudyView />,
};
