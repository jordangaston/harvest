import { View } from "react-native";
import { Grain } from "../../components/recime/Grain";
import type { Study } from "../types.ts";

export const GrainStudy: Study = {
  name: "Grain",
  group: "Brand",
  controls: [{ kind: "number", key: "opacity", label: "Opacity", default: 0.07 }],
  render: ({ opacity }) => (
    <View style={{ height: 300, width: "100%", backgroundColor: "#F1E6D2" }}>
      <Grain opacity={Number(opacity)} />
    </View>
  ),
};
