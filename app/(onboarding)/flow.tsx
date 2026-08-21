import React from "react";
import { useRouter } from "expo-router";
import { OnboardingScreen } from "../../components/recime/OnboardingScreen";
import {
  OnboardingValueCard, OnboardingChipGrid, OnboardingStorePicker, OnboardingSliderStep,
  OnboardingCounter, OnboardingBinary, OnboardingSeverityPicker, OnboardingTasteMenu,
  OnboardingSingleSelectList, StepHeader, type Household,
} from "../../components/onboarding/screens";
import { MealCounts } from "../../components/planner/MealPlanIntake";
import { OptionRow } from "../../components/recime/OptionRow";
import { VStack, HStack, Text } from "../../components/ui";
import {
  ALLERGENS, DIETS, EQUIPMENT, ALL_EQUIPMENT, EQUIP_TYPE_TO_LABEL,
  TASTE_PRESETS, TASTE_CORPUS, tasteFacet, Slider, Card,
} from "../../components/onboarding/primitives";
import { setGoals, setCookDaysCount, setPreferences, getPreferencesDraft } from "../../lib/onboarding";
import { money, formatTime } from "../../components/swipe/mock";
import type { WeeklyMeals, MealType, AllergenPref, DietPref, TastePref } from "../../components/swipe/mock";

/**
 * The ordered first-run flow (WI-2). One driver holds the step index + collects every answer into
 * the shared onboarding draft; back-nav decrements the index and edits the draft (nothing persists
 * mid-flow). The final step routes into phone → verify, where the draft flushes once.
 *
 * The animated value-prop LOADER lives on the app-launch loading screen, not here (TODO: swap the
 * placeholder for a generated video). This flow opens straight into the typed value-prop cards.
 */

// Goals list (painterly icon left, checkbox right). Kid-friendly / Quick meals have no painterly
// asset yet (image-gen credits depleted) — interim Ionicons; swap to matching PNGs later.
type GoalRow = { label: string; image?: React.ComponentProps<typeof OptionRow>["image"]; icon?: React.ComponentProps<typeof OptionRow>["icon"] };
const GOALS: GoalRow[] = [
  { image: require("../../assets/goal-healthier.png"), label: "Healthy meals" },
  { icon: "happy-outline", label: "Kid friendly meals" },
  { icon: "flash-outline", label: "Quick meals" },
  { image: require("../../assets/goal-money.png"), label: "Saving money" },
  { image: require("../../assets/goal-cuisines.png"), label: "Trying new recipes" },
  { image: require("../../assets/goal-prep.png"), label: "Meal prepping" },
];

// Focus-on-text value props — the exact product copy, no subtitle. Typed one screen at a time.
const VALUE_CARDS = [
  "Harvest makes it easy to plan family meals",
  "Swipe to tell us what you like",
  "Import your favorite recipes",
  "Harvest creates custom meal plans just for you!",
  "Let's get started with a few questions",
];

const COOK_DAYS_OPTIONS = [
  { value: "2", label: "1–2 days" }, { value: "4", label: "3–4 days" },
  { value: "6", label: "5–6 days" }, { value: "7", label: "Every day" },
];

const CONFIDENCE_OPTIONS = [
  { value: "beginner", label: "Just starting out", microcopy: "We'll keep recipes simple and forgiving." },
  { value: "intermediate", label: "Comfortable in the kitchen", microcopy: "A good mix of easy and involved." },
  { value: "advanced", label: "Confident cook", microcopy: "Bring on the ambitious recipes." },
];

const EQUIPMENT_OPTIONS = EQUIPMENT.map((e) => ({ value: e.type, label: e.label }));

const MEAL_TIME_ROWS: { key: "breakfast" | "lunch" | "dinner"; label: string }[] = [
  { key: "breakfast", label: "Breakfast" }, { key: "lunch", label: "Lunch" }, { key: "dinner", label: "Dinner" },
];

/** Three per-meal cook-time sliders on one card — modeled after MealCounts. */
function MealTimeSliders({ value, onChange }: { value: Record<"breakfast" | "lunch" | "dinner", number>; onChange: (m: "breakfast" | "lunch" | "dinner", v: number) => void }) {
  return (
    <Card>
      {MEAL_TIME_ROWS.map((m) => (
        <VStack key={m.key} space={4}>
          <HStack className="items-center justify-between">
            <Text className="text-base text-ink">{m.label}</Text>
            <Text className="text-base font-bold text-brand">{formatTime(value[m.key])}</Text>
          </HStack>
          <Slider value={value[m.key]} min={10} max={120} step={5} hideValue format={formatTime} onChange={(v) => onChange(m.key, v)} />
        </VStack>
      ))}
    </Card>
  );
}

export default function OnboardingFlow() {
  const router = useRouter();
  const [step, setStep] = React.useState(0);
  const draft = getPreferencesDraft();

  const [goals, setGoalsState] = React.useState<string[]>([]);
  const [stores, setStores] = React.useState<string[]>(draft.groceryStores);
  const [budget, setBudget] = React.useState(draft.weeklyBudgetCents);
  const [household, setHousehold] = React.useState<Household>(draft.household);
  const [meals, setMeals] = React.useState<WeeklyMeals>(draft.weeklyMeals);
  const [cookDays, setCookDays] = React.useState<string | null>(null);
  const [mealTimes, setMealTimes] = React.useState(draft.timeByMeal);
  const [leftovers, setLeftovers] = React.useState<boolean | null>(draft.eatsLeftovers);
  const [allergens, setAllergens] = React.useState<AllergenPref[]>(draft.allergens);
  const [diets, setDiets] = React.useState<DietPref[]>(draft.diets);
  const [likes, setLikes] = React.useState<TastePref[]>(draft.likes);
  const [dislikes, setDislikes] = React.useState<TastePref[]>(draft.dislikes);
  const [confidence, setConfidence] = React.useState<string | null>(draft.skillLevel);
  const [equipment, setEquipment] = React.useState<string[]>(draft.ownedEquipment);

  const setMeal = (m: MealType, v: number) => setMeals((s) => ({ ...s, [m]: v }));
  const toggleGoal = (label: string) => setGoalsState((prev) => (prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label]));

  // Severity/diet pickers speak LeveledPref ({name, level}); adapt to the draft's shape.
  const allergenLeveled = allergens.map((a) => ({ name: a.allergen, level: a.severity }));
  const dietLeveled = diets.map((d) => ({ name: d.diet, level: d.strictness }));

  // Taste menus speak string[] of labels; adapt to {facet,value}[].
  const toTaste = (labels: string[]): TastePref[] => labels.map((value) => ({ facet: tasteFacet(value), value }));

  // The ordered steps. `commit` folds the step's answer into the draft; `advance` fires on Continue.
  const steps: { body: React.ReactNode; ctaLabel?: string; ctaDisabled?: boolean; commit?: () => void }[] = [
    ...VALUE_CARDS.map((headline, i) => ({
      ctaLabel: "Continue",
      body: <OnboardingValueCard key={`v${i}`} headline={headline} />,
    })),
    {
      ctaLabel: "Continue", ctaDisabled: goals.length === 0,
      commit: () => setGoals(goals),
      body: (
        <VStack style={{ paddingTop: 8 }}>
          <StepHeader title="What should we focus on?" subtitle="Select all that apply" />
          <VStack>
            {GOALS.map((g) => (
              <OptionRow key={g.label} label={g.label} image={g.image} icon={g.icon} variant="check" selected={goals.includes(g.label)} onPress={() => toggleGoal(g.label)} />
            ))}
          </VStack>
        </VStack>
      ),
    },
    {
      ctaLabel: "Continue",
      commit: () => setPreferences({ groceryStores: stores }),
      body: <OnboardingStorePicker value={stores} onChange={setStores} onSkip={() => { setStores([]); advance(); }} />,
    },
    {
      ctaLabel: "Continue",
      commit: () => setPreferences({ weeklyBudgetCents: budget }),
      body: <OnboardingSliderStep title="What’s your weekly budget?" subtitle="We’ll keep your plan under it." value={budget} min={3000} max={40000} step={1000} format={money} caption="this week" onChange={setBudget} />,
    },
    {
      ctaLabel: "Continue",
      commit: () => setPreferences({ household }),
      body: <OnboardingCounter value={household} onChange={setHousehold} />,
    },
    {
      ctaLabel: "Continue",
      commit: () => setPreferences({ weeklyMeals: meals }),
      body: (
        <VStack style={{ paddingTop: 8 }} space={16}>
          <StepHeader title="How many recipes this week?" subtitle="We’ll build your plan around this." />
          <MealCounts value={meals} onChange={setMeal} showTitle={false} types={["breakfast", "lunch", "dinner"]} />
        </VStack>
      ),
    },
    {
      ctaLabel: "Continue", ctaDisabled: cookDays === null,
      commit: () => cookDays && setCookDaysCount(Number(cookDays)),
      body: (
        <VStack style={{ paddingTop: 8 }}>
          <StepHeader title="How many days a week do you cook?" subtitle="We’ll plan for that many." />
          <VStack>
            {COOK_DAYS_OPTIONS.map((o) => (
              <OptionRow key={o.value} label={o.label} variant="pill" selected={cookDays === o.value} onPress={() => setCookDays(o.value)} />
            ))}
          </VStack>
        </VStack>
      ),
    },
    {
      ctaLabel: "Continue",
      commit: () => setPreferences({ timeByMeal: mealTimes }),
      body: (
        <VStack style={{ paddingTop: 8 }} space={16}>
          <StepHeader title="How much time do you spend?" subtitle="on a typical day" />
          <MealTimeSliders value={mealTimes} onChange={(m, v) => setMealTimes((s) => ({ ...s, [m]: v }))} />
        </VStack>
      ),
    },
    {
      ctaLabel: "Continue", ctaDisabled: leftovers === null,
      commit: () => setPreferences({ eatsLeftovers: leftovers === true }),
      body: <OnboardingBinary title="Do you eat leftovers?" subtitle="We’ll plan bigger batches if so." value={leftovers} onChange={setLeftovers}
        yes={{ label: "I don’t mind them", caption: "Cook once, eat twice." }} no={{ label: "No, fresh each time", caption: "We’ll keep portions tight." }} />,
    },
    {
      ctaLabel: "Continue",
      commit: () => setPreferences({ allergens }),
      body: <OnboardingSeverityPicker title="Any allergies?" subtitle="We’ll steer clear of these." corpus={ALLERGENS}
        levels={[{ label: "Mild", value: "mild" }, { label: "Moderate", value: "moderate" }, { label: "Severe", value: "severe" }]} defaultLevel="moderate"
        value={allergenLeveled} onChange={(v) => setAllergens(v.map((x) => ({ allergen: x.name, severity: x.level as AllergenPref["severity"] })))} />,
    },
    {
      ctaLabel: "Continue",
      commit: () => setPreferences({ diets }),
      body: <OnboardingSeverityPicker title="Any diets?" subtitle="We’ll match recipes to how you eat." corpus={DIETS}
        levels={[{ label: "Flexible", value: "flexible" }, { label: "Strict", value: "strict" }]} defaultLevel="flexible"
        value={dietLeveled} onChange={(v) => setDiets(v.map((x) => ({ diet: x.name, strictness: x.level as DietPref["strictness"] })))} />,
    },
    {
      ctaLabel: "Continue",
      commit: () => setPreferences({ likes }),
      body: <OnboardingTasteMenu title="What do you like to eat?" subtitle="Cuisines, dishes, ingredients — anything." presets={TASTE_PRESETS} corpus={TASTE_CORPUS} searchTitle="Add a taste"
        value={likes.map((t) => t.value)} onChange={(v) => setLikes(toTaste(v))} />,
    },
    {
      ctaLabel: "Continue",
      commit: () => setPreferences({ dislikes }),
      body: <OnboardingTasteMenu title="Anything to avoid?" subtitle="We’ll steer the deck away from these." presets={TASTE_PRESETS} corpus={TASTE_CORPUS} searchTitle="Add something to avoid"
        value={dislikes.map((t) => t.value)} onChange={(v) => setDislikes(toTaste(v))} />,
    },
    {
      ctaLabel: "Continue", ctaDisabled: confidence === null,
      commit: () => confidence && setPreferences({ skillLevel: confidence as typeof draft.skillLevel }),
      body: <OnboardingSingleSelectList title="What is your comfort level in the kitchen?" subtitle="We’ll match the difficulty." options={CONFIDENCE_OPTIONS} value={confidence} onSelect={setConfidence} />,
    },
    {
      ctaLabel: "Continue",
      commit: () => setPreferences({ ownedEquipment: equipment, equipmentReviewed: true }),
      body: <OnboardingChipGrid title="What's in your kitchen?" subtitle="We’ll only suggest recipes you can make." options={EQUIPMENT_OPTIONS} value={equipment} onChange={setEquipment}
        moreCorpus={ALL_EQUIPMENT.map((e) => e.type)} moreLabels={EQUIP_TYPE_TO_LABEL} moreTitle="Add equipment" />,
    },
  ];

  function advance() {
    steps[step]?.commit?.();
    if (step >= steps.length - 1) {
      // The last answer is committed; the warm-up deck creates the anonymous account,
      // flushes the draft, and lets the user react to a few recipes before the meal plan.
      router.push("/(onboarding)/recipe-swipe");
      return;
    }
    setStep((s) => s + 1);
  }

  const s = steps[step];

  return (
    <OnboardingScreen
      key={step}
      progress={(step + 1) / steps.length}
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
