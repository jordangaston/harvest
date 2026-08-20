import React from "react";
import { View } from "react-native";
import { MealPlanIntake } from "../../components/planner/MealPlanIntake";
import type { Study } from "../types.ts";

// Rendered inline (no Modal) so the studio's CommentLayer can overlay it, and with no inner
// ScrollView so comment pins stay anchored as the outer studio ScrollView moves the content.
function MealPlanIntakeStudyView() {
  return (
    <View className="w-full overflow-hidden rounded-2xl bg-cream" style={{ borderWidth: 1, borderColor: "#E4D6BC" }}>
      <MealPlanIntake onSubmit={() => {}} />
    </View>
  );
}

export const MealPlanIntakeStudy: Study = {
  name: "MealPlanIntake",
  group: "Interactive",
  render: () => <MealPlanIntakeStudyView />,
};
