import React from "react";
import { TotalTimeSheet } from "../../components/recime/TotalTimeSheet";
import { Pressable, Text, Center } from "../../components/ui";
import type { Study } from "../types.ts";

function TotalTimeSheetStudyView() {
  const [open, setOpen] = React.useState(true);
  return (
    <Center className="flex-1">
      <Pressable onPress={() => setOpen(true)} className="rounded-full border border-brand bg-brand-light px-4 py-2">
        <Text className="font-bold text-brand">Open sheet</Text>
      </Pressable>
      <TotalTimeSheet
        visible={open}
        value={30}
        onApply={() => {}}
        onClose={() => setOpen(false)}
      />
    </Center>
  );
}

export const TotalTimeSheetStudy: Study = {
  name: "TotalTimeSheet",
  group: "Sheets",
  render: () => <TotalTimeSheetStudyView />,
};
