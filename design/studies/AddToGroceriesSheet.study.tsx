import React from "react";
import { AddToGroceriesSheet } from "../../components/recime/AddToGroceriesSheet";
import { Center, Pressable, Text } from "../../components/ui";
import type { ApiRecipe } from "../../lib/api/types";
import type { Study } from "../types.ts";

const mockRecipe: ApiRecipe = {
  id: "study-recipe",
  title: "Golden Hour Pasta",
  source_type: "website",
  servings: 4,
  ingredients: [
    { name: "spaghetti", amount: "400", unit: "g" },
    { name: "olive oil", amount: "2", unit: "tbsp" },
    { name: "garlic", amount: "3", unit: "cloves" },
    { name: "parmesan", quantity_text: "a handful" },
  ],
  steps: [],
};

function AddToGroceriesSheetStudyView() {
  const [open, setOpen] = React.useState(true);
  return (
    <Center className="flex-1">
      <Pressable onPress={() => setOpen(true)} className="rounded-full border border-brand bg-brand-light px-4 py-2">
        <Text className="font-bold text-brand">Open sheet</Text>
      </Pressable>
      <AddToGroceriesSheet
        visible={open}
        recipe={mockRecipe}
        onClose={() => setOpen(false)}
        onAdded={() => {}}
      />
    </Center>
  );
}

export const AddToGroceriesSheetStudy: Study = {
  name: "AddToGroceriesSheet",
  group: "Sheets",
  render: () => <AddToGroceriesSheetStudyView />,
};
