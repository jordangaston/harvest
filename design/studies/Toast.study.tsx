import { View } from "react-native";
import { Toast } from "../../components/recime/Toast";
import type { Study } from "../types.ts";

export const ToastStudy: Study = {
  name: "Toast",
  group: "Feedback",
  controls: [{ kind: "text", key: "message", label: "Message", default: "Recipe saved" }],
  render: ({ message }) => (
    <View style={{ height: 120, width: "100%" }}>
      <Toast message={String(message)} bottom={24} />
    </View>
  ),
};
