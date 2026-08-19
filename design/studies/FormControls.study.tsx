import React from "react";
import { VStack, HStack, Input, Switch, Checkbox, Radio, Text } from "../../components/ui";
import type { Study } from "../types.ts";

function FormControlsView({ placeholder }: { placeholder: string }) {
  const [on, setOn] = React.useState(true);
  const [checked, setChecked] = React.useState(false);
  const [choice, setChoice] = React.useState<"a" | "b">("a");

  return (
    <VStack space={20} className="w-full px-6">
      <Input placeholder={placeholder} />

      <HStack space={12} className="items-center">
        <Switch value={on} onValueChange={setOn} />
        <Text className="text-ink">Notifications {on ? "on" : "off"}</Text>
      </HStack>

      <HStack space={12} className="items-center">
        <Checkbox checked={checked} onToggle={() => setChecked((c) => !c)} />
        <Text className="text-ink">Weeknight friendly</Text>
      </HStack>

      <VStack space={10}>
        <HStack space={12} className="items-center">
          <Radio selected={choice === "a"} onSelect={() => setChoice("a")} />
          <Text className="text-ink">Metric</Text>
        </HStack>
        <HStack space={12} className="items-center">
          <Radio selected={choice === "b"} onSelect={() => setChoice("b")} />
          <Text className="text-ink">Imperial</Text>
        </HStack>
      </VStack>
    </VStack>
  );
}

export const FormControlsStudy: Study = {
  name: "Form Controls",
  group: "Primitives",
  controls: [
    { kind: "text", key: "placeholder", label: "Placeholder", default: "Search recipes…" },
  ],
  render: ({ placeholder }) => <FormControlsView placeholder={String(placeholder)} />,
};
