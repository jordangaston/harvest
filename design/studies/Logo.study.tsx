import { Logo } from "../../components/recime/Logo";
import type { Study } from "../types.ts";

export const LogoStudy: Study = {
  name: "Logo",
  group: "Brand",
  controls: [
    { kind: "number", key: "size", label: "Size", default: 20 },
    {
      kind: "enum",
      key: "color",
      label: "Color",
      options: ["#8A4A1E", "#2E2419", "#A85E2B", "#FBF6EC"],
      default: "#8A4A1E",
    },
  ],
  render: ({ size, color }) => <Logo size={Number(size)} color={String(color)} />,
};
