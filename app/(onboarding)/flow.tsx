import React from "react";
import { useRouter } from "expo-router";
import { OnboardingScreen } from "../../components/recime/OnboardingScreen";
import {
  OnboardingValueCarousel, OnboardingValueCard, OnboardingChipGrid, OnboardingStorePicker,
  OnboardingBudget, OnboardingCounter, OnboardingDayPicker, OnboardingBinary,
  OnboardingSeverityPicker, OnboardingTasteMenu, OnboardingSingleSelectList, type Household,
} from "../../components/onboarding/screens";
import { MealCounts } from "../../components/planner/MealPlanIntake";
import {
  ALLERGENS, DIETS, EQUIPMENT, ALL_EQUIPMENT, EQUIP_LABEL_TO_TYPE,
  TASTE_PRESETS, TASTE_CORPUS, tasteFacet,
} from "../../components/onboarding/primitives";
import { setGoals, setCookDays, setPreferences, getPreferencesDraft } from "../../lib/onboarding";
import type { WeeklyMeals, MealType, AllergenPref, DietPref, TastePref } from "../../components/swipe/mock";

/**
 * The ordered first-run flow (WI-2). One driver holds the step index + collects every answer into
 * the shared onboarding draft; back-nav decrements the index and edits the draft (nothing persists
 * mid-flow). The final archetype step routes into phone → verify, where the draft flushes once.
 *
 * Screens compose the approved archetypes (components/onboarding/*) inside the OnboardingScreen shell.
 */

const GOAL_OPTIONS = [
  "Eat healthier", "Save money", "Improve cooking skills", "Organize recipes",
  "Plan out meals", "Meal prepping", "Try new cuisines", "Kid-friendly meals",
].map((label) => ({ value: label, label }));

const TIME_OPTIONS = [
  { value: "15", label: "15 min" }, { value: "30", label: "30 min" },
  { value: "45", label: "45 min" }, { value: "60", label: "1 hour" }, { value: "90", label: "90 min+" },
];

const CONFIDENCE_OPTIONS = [
  { value: "beginner", label: "Just starting out", microcopy: "We'll keep recipes simple and forgiving." },
  { value: "intermediate", label: "Comfortable in the kitchen", microcopy: "A good mix of easy and involved." },
  { value: "advanced", label: "Confident cook", microcopy: "Bring on the ambitious recipes." },
] as const;

const EQUIPMENT_OPTIONS = EQUIPMENT.map((e) => ({ value: e.type, label: e.label }));

const VALUE_CARDS = [
  { headline: "Cooking should feel like yours.", body: "Harvest learns your taste one swipe at a time." },
  { headline: "Every recipe, ranked for you.", body: "Budget, time, and what's in your kitchen — all considered." },
  { headline: "Plan a week in minutes.", body: "The recipes you love become a plan and a grocery list." },
  { headline: "Waste less, spend less.", body: "We size portions and stay under your budget." },
  { headline: "You're in control.", body: "Change any preference anytime — the deck re-ranks instantly." },
];

// The archetype steps, in order. `phone` follows as the final step (a separate route so OTP owns it).
// Each renders inside OnboardingScreen with a progress value; the driver owns index + validity.
export default function OnboardingFlow() {
  const router = useRouter();
  const [step, setStep] = React.useState(0);
  const draft = getPreferencesDraft();

  const [goals, setGoalsState] = React.useState<string[]>([]);
  const [stores, setStores] = React.useState<string[]>(draft.groceryStores);
  const [budget, setBudget] = React.useState(draft.weeklyBudgetCents);
  const [household, setHousehold] = React.useState<Household>(draft.household);
  const [meals, setMeals] = React.useState<WeeklyMeals>(draft.weeklyMeals);
  const [days, setDays] = React.useState<string[]>([]);
  const [time, setTime] = React.useState<string[]>([String(draft.timeBudgetMin)]);
  const [leftovers, setLeftovers] = React.useState<boolean | null>(draft.eatsLeftovers);
  const [allergens, setAllergens] = React.useState<AllergenPref[]>(draft.allergens);
  const [diets, setDiets] = React.useState<DietPref[]>(draft.diets);
  const [likes, setLikes] = React.useState<TastePref[]>(draft.likes);
  const [dislikes, setDislikes] = React.useState<TastePref[]>(draft.dislikes);
  const [confidence, setConfidence] = React.useState<string | null>(draft.skillLevel);
  const [equipment, setEquipment] = React.useState<string[]>(draft.ownedEquipment);

  const setMeal = (m: MealType, v: number) => setMeals((s) => ({ ...s, [m]: v }));

  // Severity/diet pickers speak LeveledPref ({name, level}); adapt to the draft's shape.
  const allergenLeveled = allergens.map((a) => ({ name: a.allergen, level: a.severity }));
  const dietLeveled = diets.map((d) => ({ name: d.diet, level: d.strictness }));

  // Taste menus speak string[] of labels; adapt to {facet,value}[].
  const toTaste = (labels: string[]): TastePref[] => labels.map((value) => ({ facet: tasteFacet(value), value }));

  // The ordered steps. `commit` folds the step's answer into the draft; `next` fires on Continue.
  const steps: { progress: number; body: React.ReactNode; ctaLabel?: string; ctaDisabled?: boolean; commit?: () => void; auto?: boolean }[] = [
    { progress: 0.02, auto: true, body: <OnboardingValueCarousel slides={VALUE_CARDS.slice(0, 3).map((c) => ({ title: c.headline, caption: c.body }))} /> },
    { progress: 0.05, body: <OnboardingValueCard headline="Welcome to Harvest" body="Let's set up a deck that's all yours." typing={false} ctaLabel="Get started" onContinue={() => advance()} /> },
    ...VALUE_CARDS.map((c, i) => ({
      progress: 0.08 + i * 0.02,
      body: <OnboardingValueCard key={`v${i}`} headline={c.headline} body={c.body} onContinue={() => advance()} />,
    })),
    {
      progress: 0.22, ctaLabel: "Continue", ctaDisabled: goals.length === 0,
      commit: () => setGoals(goals),
      body: <OnboardingChipGrid title="What are your goals?" subtitle="Select all that apply" options={GOAL_OPTIONS} value={goals} onChange={setGoalsState} />,
    },
    {
      progress: 0.28, ctaLabel: "Continue",
      commit: () => setPreferences({ groceryStores: stores }),
      body: <OnboardingStorePicker value={stores} onChange={setStores} onSkip={() => { setStores([]); advance(); }} />,
    },
    {
      progress: 0.34, ctaLabel: "Continue",
      commit: () => setPreferences({ weeklyBudgetCents: budget }),
      body: <OnboardingBudget cents={budget} onChange={setBudget} />,
    },
    {
      progress: 0.4, ctaLabel: "Continue",
      commit: () => setPreferences({ household }),
      body: <OnboardingCounter value={household} onChange={setHousehold} />,
    },
    {
      progress: 0.46, ctaLabel: "Continue",
      commit: () => setPreferences({ weeklyMeals: meals }),
      body: <MealCounts value={meals} onChange={setMeal} />,
    },
    {
      progress: 0.52, ctaLabel: "Continue", ctaDisabled: days.length === 0,
      commit: () => setCookDays(days),
      body: <OnboardingDayPicker value={days} onChange={setDays} />,
    },
    {
      progress: 0.58, ctaLabel: "Continue", ctaDisabled: time.length === 0,
      commit: () => setPreferences({ timeBudgetMin: Number(time[0]) }),
      body: <OnboardingChipGrid title="How long to cook?" subtitle="On a typical night" options={TIME_OPTIONS} value={time} onChange={setTime} multi={false} />,
    },
    {
      progress: 0.64, ctaLabel: "Continue", ctaDisabled: leftovers === null,
      commit: () => setPreferences({ eatsLeftovers: leftovers === true }),
      body: <OnboardingBinary title="Do you eat leftovers?" subtitle="We'll plan bigger batches if so." value={leftovers} onChange={setLeftovers}
        yes={{ label: "Yes, love them", caption: "Cook once, eat twice." }} no={{ label: "No, fresh each time", caption: "We'll keep portions tight." }} />,
    },
    {
      progress: 0.7, ctaLabel: "Continue",
      commit: () => setPreferences({ allergens }),
      body: <OnboardingSeverityPicker title="Any allergies?" subtitle="We'll never suggest these." corpus={ALLERGENS}
        levels={[{ label: "Mild", value: "mild" }, { label: "Moderate", value: "moderate" }, { label: "Severe", value: "severe" }]} defaultLevel="moderate"
        value={allergenLeveled} onChange={(v) => setAllergens(v.map((x) => ({ allergen: x.name, severity: x.level as AllergenPref["severity"] })))} />,
    },
    {
      progress: 0.76, ctaLabel: "Continue",
      commit: () => setPreferences({ diets }),
      body: <OnboardingSeverityPicker title="Any diets?" subtitle="We'll match recipes to how you eat." corpus={DIETS}
        levels={[{ label: "Flexible", value: "flexible" }, { label: "Strict", value: "strict" }]} defaultLevel="flexible"
        value={dietLeveled} onChange={(v) => setDiets(v.map((x) => ({ diet: x.name, strictness: x.level as DietPref["strictness"] })))} />,
    },
    {
      progress: 0.82, ctaLabel: "Continue",
      commit: () => setPreferences({ likes }),
      body: <OnboardingTasteMenu title="What do you love?" subtitle="Cuisines, dishes, ingredients — anything." presets={TASTE_PRESETS} corpus={TASTE_CORPUS} searchTitle="Add a taste"
        value={likes.map((t) => t.value)} onChange={(v) => setLikes(toTaste(v))} />,
    },
    {
      progress: 0.86, ctaLabel: "Continue",
      commit: () => setPreferences({ dislikes }),
      body: <OnboardingTasteMenu title="Anything to avoid?" subtitle="We'll steer the deck away from these." presets={TASTE_PRESETS} corpus={TASTE_CORPUS} searchTitle="Add something to avoid"
        value={dislikes.map((t) => t.value)} onChange={(v) => setDislikes(toTaste(v))} />,
    },
    {
      progress: 0.9, ctaLabel: "Continue", ctaDisabled: confidence === null,
      commit: () => confidence && setPreferences({ skillLevel: confidence as typeof draft.skillLevel }),
      body: <OnboardingSingleSelectList title="How do you cook?" subtitle="We'll match the difficulty." options={CONFIDENCE_OPTIONS.map((o) => ({ value: o.value, label: o.label, microcopy: o.microcopy }))} value={confidence} onSelect={setConfidence} />,
    },
    {
      progress: 0.94, ctaLabel: "Continue",
      // The grid holds preset chips by `type` and search-added chips by `label`; normalise to types.
      commit: () => setPreferences({ ownedEquipment: equipment.map((v) => EQUIP_LABEL_TO_TYPE[v] ?? v), equipmentReviewed: true }),
      body: <OnboardingChipGrid title="What's in your kitchen?" subtitle="We'll only suggest recipes you can make." options={EQUIPMENT_OPTIONS} value={equipment} onChange={setEquipment}
        moreCorpus={ALL_EQUIPMENT.map((e) => e.label)} moreTitle="Add equipment" />,
    },
  ];

  function advance() {
    const current = steps[step];
    current?.commit?.();
    if (step >= steps.length - 1) {
      router.push("/(onboarding)/phone");
      return;
    }
    setStep((s) => s + 1);
  }

  const s = steps[step];

  // The value carousel is a loader — it plays its slides, then advances itself into the flow.
  React.useEffect(() => {
    if (!s.auto) return;
    const t = setTimeout(() => setStep((n) => (n === step ? n + 1 : n)), 6600);
    return () => clearTimeout(t);
  }, [step, s.auto]);

  return (
    <OnboardingScreen
      key={step}
      progress={s.progress}
      showBack={step > 0}
      onBack={step > 0 ? () => setStep((n) => Math.max(0, n - 1)) : undefined}
      onSkip={undefined}
      ctaLabel={s.ctaLabel}
      ctaDisabled={s.ctaDisabled}
      onCta={s.ctaLabel ? advance : undefined}
    >
      {s.body}
    </OnboardingScreen>
  );
}
