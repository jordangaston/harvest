import React from "react";
import { AddRecipeSheet } from "../../components/recime/AddRecipeSheet";
import { Pressable, Text, Center } from "../../components/ui";
import type { Study } from "../types.ts";

function AddRecipeSheetStudyView() {
  const [open, setOpen] = React.useState(true);
  return (
    <Center className="flex-1">
      <Pressable onPress={() => setOpen(true)} className="rounded-full border border-brand bg-brand-light px-4 py-2">
        <Text className="font-bold text-brand">Open sheet</Text>
      </Pressable>
      <AddRecipeSheet visible={open} onClose={() => setOpen(false)} onNewCookbook={() => {}} />
    </Center>
  );
}

export const AddRecipeSheetStudy: Study = {
  name: "AddRecipeSheet",
  group: "Sheets",
  render: () => <AddRecipeSheetStudyView />,
};
