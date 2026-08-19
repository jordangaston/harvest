import React from "react";
import { MealAddRecipeSheet } from "../../components/recime/MealAddRecipeSheet";
import { Pressable, Text, Center } from "../../components/ui";
import type { Study } from "../types.ts";

function MealAddRecipeSheetStudyView() {
  const [open, setOpen] = React.useState(true);
  return (
    <Center className="flex-1">
      <Pressable onPress={() => setOpen(true)} className="rounded-full border border-brand bg-brand-light px-4 py-2">
        <Text className="font-bold text-brand">Open sheet</Text>
      </Pressable>
      <MealAddRecipeSheet
        visible={open}
        date="2026-08-18"
        meal="dinner"
        onAdded={() => {}}
        onClose={() => setOpen(false)}
      />
    </Center>
  );
}

export const MealAddRecipeSheetStudy: Study = {
  name: "MealAddRecipeSheet",
  group: "Sheets",
  render: () => <MealAddRecipeSheetStudyView />,
};
