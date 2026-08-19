import { OptionRow } from "../../components/recime/OptionRow";
import type { Study } from "../types.ts";

export const OptionRowStudy: Study = {
  name: "OptionRow",
  group: "Rows",
  controls: [
    { kind: "text", key: "label", label: "Label", default: "Weeknight dinners" },
    { kind: "boolean", key: "selected", label: "Selected", default: false },
    { kind: "enum", key: "variant", label: "Variant", options: ["check", "pill"], default: "check" },
    { kind: "text", key: "emoji", label: "Emoji", default: "🍝" },
  ],
  render: ({ label, selected, variant, emoji }) => (
    <OptionRow
      label={String(label)}
      selected={Boolean(selected)}
      variant={variant === "pill" ? "pill" : "check"}
      emoji={String(emoji) || undefined}
      onPress={() => {}}
    />
  ),
};
