import React from "react";
import { AddToPlanSheet } from "../../components/recime/AddToPlanSheet";
import { Center, Pressable, Text } from "../../components/ui";
import type { Study } from "../types.ts";

function AddToPlanSheetStudyView() {
  const [open, setOpen] = React.useState(true);
  return (
    <Center className="flex-1">
      <Pressable onPress={() => setOpen(true)} className="rounded-full border border-brand bg-brand-light px-4 py-2">
        <Text className="font-bold text-brand">Open sheet</Text>
      </Pressable>
      <AddToPlanSheet
        visible={open}
        recipeId="study-recipe"
        onAdded={() => {}}
        onClose={() => setOpen(false)}
      />
    </Center>
  );
}

export const AddToPlanSheetStudy: Study = {
  name: "AddToPlanSheet",
  group: "Sheets",
  render: () => <AddToPlanSheetStudyView />,
};
