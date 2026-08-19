import React from "react";
import { AddGrocerySheet } from "../../components/recime/AddGrocerySheet";
import { Center, Pressable, Text } from "../../components/ui";
import type { Study } from "../types.ts";

function AddGrocerySheetStudyView() {
  const [open, setOpen] = React.useState(true);
  return (
    <Center className="flex-1">
      <Pressable onPress={() => setOpen(true)} className="rounded-full border border-brand bg-brand-light px-4 py-2">
        <Text className="font-bold text-brand">Open sheet</Text>
      </Pressable>
      <AddGrocerySheet visible={open} onClose={() => setOpen(false)} />
    </Center>
  );
}

export const AddGrocerySheetStudy: Study = {
  name: "AddGrocerySheet",
  group: "Sheets",
  render: () => <AddGrocerySheetStudyView />,
};
