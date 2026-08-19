import React from "react";
import { CookbookPickerSheet } from "../../components/recime/CookbookPickerSheet";
import { Pressable, Text, Center } from "../../components/ui";
import type { Study } from "../types.ts";

function CookbookPickerSheetStudyView() {
  const [open, setOpen] = React.useState(true);
  return (
    <Center className="flex-1">
      <Pressable onPress={() => setOpen(true)} className="rounded-full border border-brand bg-brand-light px-4 py-2">
        <Text className="font-bold text-brand">Open sheet</Text>
      </Pressable>
      <CookbookPickerSheet
        visible={open}
        recipeIds={["demo-recipe-1"]}
        onClose={() => setOpen(false)}
        onSaved={() => {}}
      />
    </Center>
  );
}

export const CookbookPickerSheetStudy: Study = {
  name: "CookbookPickerSheet",
  group: "Sheets",
  render: () => <CookbookPickerSheetStudyView />,
};
