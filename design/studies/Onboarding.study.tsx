import React from "react";
import { View } from "react-native";
import type { Study } from "../types.ts";
import {
  OnboardingValueCard, OnboardingChipGrid, OnboardingStorePicker,
  OnboardingSliderStep, OnboardingCounter, OnboardingDayPicker, OnboardingBinary,
  OnboardingSeverityPicker, OnboardingTasteMenu, OnboardingSingleSelectList,
  type Household, type LeveledPref,
} from "../../components/onboarding/screens";
import {
  ALLERGENS, DIETS, EQUIPMENT, ALL_EQUIPMENT, TASTE_PRESETS, TASTE_CORPUS,
} from "../../components/onboarding/primitives";
import { money } from "../../components/swipe/mock";

// Every onboarding archetype is rendered INLINE in a cream frame (like SwipeSettings) so the
// studio's CommentLayer can pin reviews to it. Each view holds its own draft state, matching how
// the Phase-2 flow will own it. Components are otherwise controlled + presentational.
const GROUP = "Onboarding";
function Frame({ children }: { children: React.ReactNode }) {
  // The archetypes no longer self-pad horizontally (the flow shell owns it), so the studio Frame
  // provides the inset here — matching the shell's ~24px so previews read like the live screen.
  return <View className="w-full overflow-hidden rounded-2xl bg-cream" style={{ borderWidth: 1, borderColor: "#E4D6BC", paddingHorizontal: 20, paddingVertical: 16 }}>{children}</View>;
}

/* 1. Value card (typing + haptics) */
function ValueCardView({ headline, body, typing, haptics }: { headline: string; body: string; typing: boolean; haptics: boolean }) {
  return <Frame><OnboardingValueCard headline={headline} body={body} typing={typing} haptics={haptics} /></Frame>;
}
export const OnboardingValueCardStudy: Study = {
  name: "OnboardingValueCard", group: GROUP,
  controls: [
    { kind: "text", key: "headline", label: "Headline", default: "Harvest makes it easy to plan family meals" },
    { kind: "text", key: "body", label: "Body", default: "A few warm questions and your first deck already knows you." },
    { kind: "boolean", key: "typing", label: "Typing effect", default: true },
    { kind: "boolean", key: "haptics", label: "Haptics", default: true },
  ],
  render: (v) => <ValueCardView headline={String(v.headline)} body={String(v.body)} typing={Boolean(v.typing)} haptics={Boolean(v.haptics)} />,
};

/* 3. Chip grid (goals / time-bands / equipment) */
const GOALS = ["Eat healthier", "Save money", "Improve cooking skills", "Organize recipes", "Plan out meals", "Meal prepping", "Try new cuisines", "Kid-friendly meals"].map((l) => ({ value: l, label: l }));
const TIME_BANDS = ["Under 20 min", "20–35 min", "35–45 min", "45–60 min", "60+ min"].map((l) => ({ value: l, label: l }));
const EQUIP_OPTS = EQUIPMENT.map((e) => ({ value: e.label, label: e.label }));
function ChipGridView({ dataset }: { dataset: string }) {
  const [value, setValue] = React.useState<string[]>([]);
  if (dataset === "Time to cook") return <Frame><OnboardingChipGrid title="How much time can you cook?" subtitle="Pick your usual weeknight." options={TIME_BANDS} value={value} onChange={setValue} multi={false} /></Frame>;
  if (dataset === "Kitchen equipment") return <Frame><OnboardingChipGrid title="What’s in your kitchen?" subtitle="Tap what you’ve got or want to use." options={EQUIP_OPTS} value={value} onChange={setValue} moreCorpus={ALL_EQUIPMENT.map((e) => e.label)} moreTitle="Add kitchen equipment" /></Frame>;
  return <Frame><OnboardingChipGrid title="What are your goals?" subtitle="Select all that apply." options={GOALS} value={value} onChange={setValue} /></Frame>;
}
export const OnboardingChipGridStudy: Study = {
  name: "OnboardingChipGrid", group: GROUP,
  controls: [{ kind: "enum", key: "dataset", label: "Dataset", options: ["Goals", "Time to cook", "Kitchen equipment"], default: "Goals" }],
  render: (v) => <ChipGridView dataset={String(v.dataset)} />,
};

/* 4. Store picker */
function StorePickerView() {
  const [value, setValue] = React.useState<string[]>(["kroger"]);
  return <Frame><OnboardingStorePicker value={value} onChange={setValue} onSkip={() => setValue([])} /></Frame>;
}
export const OnboardingStorePickerStudy: Study = { name: "OnboardingStorePicker", group: GROUP, render: () => <StorePickerView /> };

/* 5. Slider step (budget / time) */
function BudgetView() {
  const [cents, setCents] = React.useState(15500);
  return <Frame><OnboardingSliderStep title="What’s your weekly budget?" subtitle="We’ll keep your plan under it." value={cents} min={3000} max={40000} step={1000} format={money} caption="this week" onChange={setCents} /></Frame>;
}
export const OnboardingBudgetStudy: Study = { name: "OnboardingBudget", group: GROUP, render: () => <BudgetView /> };

/* 6. Household counter */
function CounterView() {
  const [hh, setHh] = React.useState<Household>({ adults: 2, kids: 1 });
  return <Frame><OnboardingCounter value={hh} onChange={setHh} /></Frame>;
}
export const OnboardingCounterStudy: Study = { name: "OnboardingCounter", group: GROUP, render: () => <CounterView /> };

/* 7. Day picker */
function DayPickerView() {
  const [days, setDays] = React.useState<string[]>(["mon", "tue", "wed", "thu", "fri"]);
  return <Frame><OnboardingDayPicker value={days} onChange={setDays} /></Frame>;
}
export const OnboardingDayPickerStudy: Study = { name: "OnboardingDayPicker", group: GROUP, render: () => <DayPickerView /> };

/* 8. Binary (leftovers) */
function BinaryView() {
  const [v, setV] = React.useState<boolean | null>(null);
  return <Frame><OnboardingBinary title="Will your family eat leftovers?" subtitle="It helps us plan for batch cooking." value={v} onChange={setV}
    yes={{ label: "Yes, we love leftovers", caption: "We’ll lean into make-ahead, batch-friendly meals." }}
    no={{ label: "No, fresh each time", caption: "We’ll plan smaller, single-night portions." }} /></Frame>;
}
export const OnboardingBinaryStudy: Study = { name: "OnboardingBinary", group: GROUP, render: () => <BinaryView /> };

/* 9. Severity picker (allergens / diets) */
function SeverityView({ kind }: { kind: string }) {
  const [value, setValue] = React.useState<LeveledPref[]>(kind === "Diets" ? [{ name: "Pescatarian", level: "flexible" }] : [{ name: "peanut", level: "severe" }]);
  if (kind === "Diets") {
    return <Frame><OnboardingSeverityPicker title="Do you follow a diet?" subtitle="Add any that apply." corpus={DIETS} defaultLevel="flexible"
      levels={[{ label: "Flexible", value: "flexible" }, { label: "Strict", value: "strict" }]} value={value} onChange={setValue}
      confirm={(p) => `Got it — we’ll keep it ${p.name.toLowerCase()}${p.level === "strict" ? ", strictly." : " where we can."}`} /></Frame>;
  }
  return <Frame><OnboardingSeverityPicker title="Any allergies we should know about?" subtitle="Add any that apply." corpus={ALLERGENS} defaultLevel="moderate"
    levels={[{ label: "Mild", value: "mild" }, { label: "Moderate", value: "moderate" }, { label: "Severe", value: "severe" }]} value={value} onChange={setValue}
    confirm={(p) => `Got it — we’ll avoid ${p.name}.`} /></Frame>;
}
export const OnboardingSeverityPickerStudy: Study = {
  name: "OnboardingSeverityPicker", group: GROUP,
  controls: [{ kind: "enum", key: "kind", label: "Kind", options: ["Allergens", "Diets"], default: "Allergens" }],
  render: (v) => <SeverityView kind={String(v.kind)} />,
};

/* 10. Taste menu (cuisines / disliked) */
function TasteView({ kind }: { kind: string }) {
  const [value, setValue] = React.useState<string[]>(kind === "Dislikes" ? ["Olives", "Liver"] : ["Italian", "Bowls", "Salmon"]);
  // One combined picker (cuisines + dish types + ingredients) for both the want and avoid screens.
  if (kind === "Dislikes") return <Frame><OnboardingTasteMenu title="Anything you don’t like?" subtitle="Cuisines, dishes, or ingredients to keep off your deck." presets={TASTE_PRESETS} corpus={TASTE_CORPUS} searchTitle="Add something to avoid" value={value} onChange={setValue} /></Frame>;
  return <Frame><OnboardingTasteMenu title="Anything you want on the menu?" subtitle="Cuisines, dishes, or ingredients you love." presets={TASTE_PRESETS} corpus={TASTE_CORPUS} searchTitle="Add a favourite" value={value} onChange={setValue} /></Frame>;
}
export const OnboardingTasteMenuStudy: Study = {
  name: "OnboardingTasteMenu", group: GROUP,
  controls: [{ kind: "enum", key: "kind", label: "Kind", options: ["Cuisines", "Dislikes"], default: "Cuisines" }],
  render: (v) => <TasteView kind={String(v.kind)} />,
};

/* 11. Single-select list (confidence) */
function ConfidenceView() {
  const [value, setValue] = React.useState<string | null>("beginner");
  return <Frame><OnboardingSingleSelectList title="How confident are you in the kitchen?" value={value} onSelect={setValue} options={[
    { value: "beginner", label: "Still learning", icon: "leaf-outline", microcopy: "Most cooks are — we’ll keep steps simple." },
    { value: "intermediate", label: "Comfortable", icon: "restaurant-outline", microcopy: "Nice — we’ll mix in a few new techniques." },
    { value: "advanced", label: "Cooking enthusiast", icon: "flame-outline", microcopy: "We’ll surface bolder, more ambitious recipes." },
  ]} /></Frame>;
}
export const OnboardingSingleSelectListStudy: Study = { name: "OnboardingSingleSelectList", group: GROUP, render: () => <ConfidenceView /> };
