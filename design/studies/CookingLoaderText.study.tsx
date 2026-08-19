import { CookingLoaderText } from "../../components/recime/CookingLoaderText";
import type { Study } from "../types.ts";

export const CookingLoaderTextStudy: Study = {
  name: "CookingLoaderText",
  group: "Feedback",
  controls: [
    { kind: "number", key: "size", label: "Size", default: 22 },
    {
      kind: "enum",
      key: "color",
      label: "Color",
      options: ["#2E2419", "#8A4A1E", "#A85E2B"],
      default: "#2E2419",
    },
  ],
  render: ({ size, color }) => <CookingLoaderText size={Number(size)} color={String(color)} />,
};
