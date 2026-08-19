import { View } from "react-native";
import { LoadingScreen } from "../../components/recime/LoadingScreen";
import type { Study } from "../types.ts";

export const LoadingScreenStudy: Study = {
  name: "LoadingScreen",
  group: "Feedback",
  render: () => (
    <View style={{ height: 400, width: "100%" }}>
      <LoadingScreen />
    </View>
  ),
};
