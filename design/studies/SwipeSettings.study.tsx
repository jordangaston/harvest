import React from "react";
import { View } from "react-native";
import { SettingsContent } from "../../components/swipe/SettingsScreen";
import type { Study } from "../types.ts";

// Rendered INLINE (not in a Modal) so the studio's CommentLayer can overlay it — a
// Modal renders above everything and can't be annotated. The deck's gear still opens
// the modal version (SettingsScreen).
function SwipeSettingsStudyView() {
  return (
    <View className="w-full overflow-hidden rounded-2xl bg-cream" style={{ borderWidth: 1, borderColor: "#E4D6BC" }}>
      <SettingsContent onClose={() => {}} embedded />
    </View>
  );
}

export const SwipeSettingsStudy: Study = {
  name: "SwipeSettings",
  group: "Interactive",
  render: () => <SwipeSettingsStudyView />,
};
