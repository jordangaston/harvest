import { ProgressHeader } from "../../components/recime/ProgressHeader";
import type { Study } from "../types.ts";

export const ProgressHeaderStudy: Study = {
  name: "ProgressHeader",
  group: "Onboarding",
  controls: [
    { kind: "number", key: "progress", label: "Progress (0-1)", default: 0.3 },
    { kind: "boolean", key: "showBack", label: "Show back", default: true },
    { kind: "boolean", key: "showSkip", label: "Show skip", default: true },
  ],
  render: ({ progress, showBack, showSkip }) => (
    <ProgressHeader
      progress={Number(progress)}
      showBack={Boolean(showBack)}
      onSkip={showSkip ? () => {} : undefined}
    />
  ),
};
