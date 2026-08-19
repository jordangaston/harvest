import React from "react";
import { SwipeDeck } from "../../components/swipe/SwipeDeck";
import type { Study } from "../types.ts";

// The Design Studio wraps every study in a CommentLayer (app/studio/[name].tsx), so this
// study just renders the component; its committed comment seed is in design/comments/.
function SwipeDeckStudyView({ initial, failSaves, reduceMotion }: { initial: string; failSaves: boolean; reduceMotion: boolean }) {
  return (
    <SwipeDeck
      initial={initial as "deck" | "empty" | "error"}
      failSaves={failSaves}
      forceReduceMotion={reduceMotion}
    />
  );
}

export const SwipeDeckStudy: Study = {
  name: "SwipeDeck",
  group: "Interactive",
  controls: [
    { kind: "enum", key: "initial", label: "Start state", options: ["deck", "empty", "error"], default: "deck" },
    { kind: "boolean", key: "failSaves", label: "Simulate save failures", default: false },
    { kind: "boolean", key: "reduceMotion", label: "Reduce motion", default: false },
  ],
  render: ({ initial, failSaves, reduceMotion }) => (
    <SwipeDeckStudyView initial={String(initial)} failSaves={Boolean(failSaves)} reduceMotion={Boolean(reduceMotion)} />
  ),
};
