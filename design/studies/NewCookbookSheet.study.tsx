import React from "react";
import { NewCookbookSheet } from "../../components/recime/NewCookbookSheet";
import { Pressable, Text, Center } from "../../components/ui";
import type { Study } from "../types.ts";

function NewCookbookSheetStudyView() {
  const [open, setOpen] = React.useState(true);
  return (
    <Center className="flex-1">
      <Pressable onPress={() => setOpen(true)} className="rounded-full border border-brand bg-brand-light px-4 py-2">
        <Text className="font-bold text-brand">Open sheet</Text>
      </Pressable>
      <NewCookbookSheet visible={open} onClose={() => setOpen(false)} onCreated={() => {}} />
    </Center>
  );
}

export const NewCookbookSheetStudy: Study = {
  name: "NewCookbookSheet",
  group: "Sheets",
  render: () => <NewCookbookSheetStudyView />,
};
