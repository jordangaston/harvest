import { ImportDemoCard } from "../../components/recime/ImportDemoCard";
import type { Study } from "../types.ts";

export const ImportDemoCardStudy: Study = {
  name: "ImportDemoCard",
  group: "Recipe",
  controls: [
    { kind: "enum", key: "variant", label: "Variant", options: ["social", "web"], default: "social" },
  ],
  render: ({ variant }) => (
    <ImportDemoCard
      variant={variant === "web" ? "web" : "social"}
      image={{ uri: "https://picsum.photos/seed/harvest/600/400" }}
      onDone={() => {}}
    />
  ),
};
