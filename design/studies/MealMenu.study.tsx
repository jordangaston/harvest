import { MealMenu } from "../../components/recime/MealMenu";
import type { Study } from "../types.ts";

export const MealMenuStudy: Study = {
  name: "MealMenu",
  group: "Menus",
  controls: [
    { kind: "boolean", key: "visible", label: "Visible", default: true },
    { kind: "text", key: "title", label: "Title", default: "Add to meal plan" },
  ],
  render: ({ visible, title }) => (
    <MealMenu
      visible={Boolean(visible)}
      title={String(title)}
      onPick={() => {}}
      onClose={() => {}}
    />
  ),
};
