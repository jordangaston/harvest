import { StepText } from "../../components/recime/StepText";
import type { Study } from "../types.ts";
import type { ApiIngredient } from "../../lib/api/types";

const INGREDIENTS: ApiIngredient[] = [
  { name: "butter", quantity_text: "2 tbsp" },
  { name: "garlic", quantity_text: "3 cloves, minced" },
  { name: "chicken thighs", quantity_text: "1 lb" },
];

export const StepTextStudy: Study = {
  name: "StepText",
  group: "Recipe",
  controls: [
    {
      kind: "text",
      key: "step",
      label: "Step",
      default: "Melt the butter, add the garlic, then sear the chicken thighs until golden.",
    },
  ],
  render: ({ step }) => (
    <StepText step={String(step)} ingredients={INGREDIENTS} onSelect={() => {}} />
  ),
};
