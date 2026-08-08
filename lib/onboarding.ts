// A read-once accumulator for onboarding answers (same idiom as savedToast.ts):
// each screen records the user's selection here as they advance, and the signup
// POST drains it once. Screens pass their DISPLAY labels; we map them to the
// server's snake_case enum values so screens never hardcode wire values.
type Payload = {
  name?: string;
  goals?: string[];
  recipe_sources?: string[];
  cook_days?: string[];
  when_cook?: string;
  cook_time?: string;
  how_heard?: string;
  age?: string;
};

// Labels are normalized before lookup (trimmed, curly apostrophes folded to
// straight) so a small punctuation drift in a screen still resolves.
function norm(label: string): string {
  return label.trim().replace(/[‘’]/g, "'");
}

function makeMap(entries: Record<string, string>): Map<string, string> {
  return new Map(Object.entries(entries).map(([label, value]) => [norm(label), value]));
}

const GOALS = makeMap({
  "Eat healthier": "eat_healthier",
  "Save money": "save_money",
  "Improve cooking skills": "improve_cooking",
  "Organize recipes": "organize_recipes",
  "Plan out meals": "plan_meals",
  "Meal prepping": "meal_prepping",
  "Try new cuisines": "try_new_cuisines",
});

const RECIPE_SOURCES = makeMap({
  "Social media": "social_media",
  "Recipe websites": "recipe_websites",
  "Printed/handwritten recipes": "printed_handwritten",
});

const COOK_DAYS = makeMap({
  Mon: "mon",
  Tue: "tue",
  Wed: "wed",
  Thu: "thu",
  Fri: "fri",
  Sat: "sat",
  Sun: "sun",
});

const WHEN_COOK = makeMap({
  "In the morning, I like to plan ahead": "morning_plan_ahead",
  "Around lunch time, when I start thinking about it": "lunchtime",
  "In the evening, when I'm ready to cook": "evening_ready",
  "Once a week, I like a fixed schedule": "weekly_schedule",
  "I meal prep": "meal_prep",
});

const COOK_TIME = makeMap({
  "Before 5 PM": "before_5pm",
  "5 – 6 PM": "from_5_to_6pm",
  "6 – 7 PM": "from_6_to_7pm",
  "7 – 8 PM": "from_7_to_8pm",
  "After 8 PM": "after_8pm",
});

const HOW_HEARD = makeMap({
  TikTok: "tiktok",
  "Google Search": "google_search",
  YouTube: "youtube",
  Instagram: "instagram",
  Pinterest: "pinterest",
  "Email Newsletter": "email_newsletter",
  "Search on App Store": "app_store_search",
  Facebook: "facebook",
  "Through a friend": "friend",
  Other: "other",
});

const AGE = makeMap({
  "24 and under": "under_24",
  "25-34": "from_25_to_34",
  "35-44": "from_35_to_44",
  "45-54": "from_45_to_54",
  "55+": "over_55",
});

let payload: Payload = {};

const enums = (map: Map<string, string>, labels: string[]): string[] =>
  labels.map((l) => map.get(norm(l))).filter((v): v is string => v !== undefined);

const one = (map: Map<string, string>, label: string): string | undefined => map.get(norm(label));

export function setName(name: string): void {
  payload.name = name.trim();
}
export function setGoals(labels: string[]): void {
  payload.goals = enums(GOALS, labels);
}
export function setRecipeSources(labels: string[]): void {
  payload.recipe_sources = enums(RECIPE_SOURCES, labels);
}
export function setCookDays(labels: string[]): void {
  payload.cook_days = enums(COOK_DAYS, labels);
}
export function setWhenCook(label: string): void {
  payload.when_cook = one(WHEN_COOK, label);
}
export function setCookTime(label: string): void {
  payload.cook_time = one(COOK_TIME, label);
}
export function setHowHeard(label: string): void {
  payload.how_heard = one(HOW_HEARD, label);
}
export function setAge(label: string): void {
  payload.age = one(AGE, label);
}

/** The collected answers, or undefined if nothing was recorded. */
export function getOnboarding(): Payload | undefined {
  return Object.keys(payload).length > 0 ? payload : undefined;
}

/** Clears the accumulator (call after a successful signup POST). */
export function resetOnboarding(): void {
  payload = {};
}
