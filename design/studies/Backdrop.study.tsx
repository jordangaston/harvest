import { View } from "react-native";
import { Backdrop } from "../../components/recime/Backdrop";
import type { Study } from "../types.ts";

export const BackdropStudy: Study = {
  name: "Backdrop",
  group: "Brand",
  render: () => (
    <View style={{ height: 300, width: "100%" }}>
      <Backdrop />
    </View>
  ),
};
