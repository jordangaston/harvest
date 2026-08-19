import { OnboardingChecklist } from "../../components/recime/OnboardingChecklist";
import type { Study } from "../types.ts";

export const OnboardingChecklistStudy: Study = {
  name: "OnboardingChecklist",
  group: "Onboarding",
  controls: [
    { kind: "boolean", key: "importFirst", label: "Import done", default: false },
    { kind: "boolean", key: "unlockShortcut", label: "Shortcut done", default: false },
    { kind: "boolean", key: "createCookbook", label: "Cookbook done", default: false },
  ],
  render: ({ importFirst, unlockShortcut, createCookbook }) => {
    const state = {
      importFirst: Boolean(importFirst),
      unlockShortcut: Boolean(unlockShortcut),
      createCookbook: Boolean(createCookbook),
      allDone: Boolean(importFirst) && Boolean(unlockShortcut) && Boolean(createCookbook),
    };
    return (
      <OnboardingChecklist
        state={state}
        onImport={() => {}}
        onShortcut={() => {}}
        onCreateCookbook={() => {}}
      />
    );
  },
};
