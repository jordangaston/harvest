import React from "react";
import { SettingsScreen } from "../../components/swipe/SettingsScreen";
import { Center, Pressable, Text } from "../../components/ui";
import type { Study } from "../types.ts";

function SwipeSettingsStudyView() {
  const [open, setOpen] = React.useState(true);
  return (
    <Center className="flex-1">
      <Pressable onPress={() => setOpen(true)} className="rounded-full border border-brand bg-brand-light px-4 py-2">
        <Text className="font-bold text-brand">Open preferences</Text>
      </Pressable>
      <SettingsScreen visible={open} onClose={() => setOpen(false)} />
    </Center>
  );
}

export const SwipeSettingsStudy: Study = {
  name: "SwipeSettings",
  group: "Interactive",
  render: () => <SwipeSettingsStudyView />,
};
