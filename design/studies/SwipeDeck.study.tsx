import React from "react";
import { SwipeDeck } from "../../components/swipe/SwipeDeck";
import { CommentLayer } from "../../components/swipe/CommentLayer";
import { SWIPE_DECK_COMMENTS } from "../comments/SwipeDeck.comments";
import type { Study } from "../types.ts";

function SwipeDeckStudyView({ initial, failSaves, reduceMotion }: { initial: string; failSaves: boolean; reduceMotion: boolean }) {
  return (
    <CommentLayer studyName="SwipeDeck" seed={SWIPE_DECK_COMMENTS}>
      <SwipeDeck
        initial={initial as "deck" | "empty" | "error"}
        failSaves={failSaves}
        forceReduceMotion={reduceMotion}
      />
    </CommentLayer>
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
