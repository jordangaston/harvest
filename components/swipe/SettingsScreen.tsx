import React from "react";
import { Modal, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ScrollView, VStack, HStack, Text, Pressable, Icon } from "../ui";
import { analytics } from "../../lib/analytics";
import { ELEVATION } from "../../lib/elevation";
import {
  Preferences, DEFAULT_PREFERENCES, COMMON_INGREDIENTS, Weights, money, formatTime, difficultyLabel, DifficultyBand,
} from "./mock";

const IMPORTANCE = [
  { label: "None", value: 0 }, { label: "Some", value: 1 }, { label: "A lot", value: 2 }, { label: "Max", value: 3 },
];
const WEIGHT_QUESTIONS: { key: keyof Weights; q: string }[] = [
  { key: "cost", q: "How much should price matter?" },
  { key: "time", q: "How much should speed matter?" },
  { key: "difficulty", q: "How much should easiness matter?" },
  { key: "nutrition", q: "How much should nutrition matter?" },
  { key: "affinity", q: "How much should your tastes matter?" },
  { key: "mealPrep", q: "How much should meal-prep matter?" },
];
const CUISINES = ["Italian", "Thai", "Mexican", "Indian", "Japanese", "Mediterranean", "Chinese", "French"];
const ALLERGENS = ["peanut", "tree nut", "milk", "egg", "soy", "wheat", "fish", "shellfish"];
const DIETS = ["Vegetarian", "Vegan", "Pescatarian", "Gluten-free", "Keto", "Paleo", "Dairy-free"];
const EQUIPMENT = [
  { type: "air_fryer", label: "Air fryer" }, { type: "slow_cooker", label: "Slow cooker" },
  { type: "pressure_cooker", label: "Pressure cooker" }, { type: "blender", label: "Blender" },
  { type: "stand_mixer", label: "Stand mixer" }, { type: "grill", label: "Grill" },
];

/* ---------- Small building blocks ---------- */
function Segmented<T extends string | number>({ options, value, onChange, label }: { options: { label: string; value: T }[]; value: T; onChange: (v: T) => void; label?: string }) {
  return (
    <View className="flex-row rounded-full bg-sand p-1" style={{ gap: 2 }} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            onPress={() => onChange(o.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            accessibilityLabel={o.label}
            className={`flex-1 items-center rounded-full py-1.5 ${active ? "bg-brand" : ""}`}
            style={active ? ELEVATION.low : undefined}
          >
            <Text className={`text-xs font-bold ${active ? "text-white" : "text-muted"}`}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Chip({ label, active, onToggle }: { label: string; active: boolean; onToggle: () => void }) {
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
      className={`rounded-full px-3.5 py-2 ${active ? "bg-brand-light" : "bg-sand-200"}`}
      style={active ? { borderWidth: 1, borderColor: "#A85E2B" } : undefined}
    >
      <Text className={`text-sm font-semibold ${active ? "text-brand" : "text-muted"}`}>{label}</Text>
    </Pressable>
  );
}

function Stepper({ label, value, onDec, onInc }: { label: string; value: string; onDec: () => void; onInc: () => void }) {
  return (
    <HStack className="items-center justify-between">
      <Text className="text-base text-ink">{label}</Text>
      <HStack className="items-center" space={14}>
        <Pressable onPress={onDec} accessibilityLabel={`Decrease ${label}`} className="h-9 w-9 items-center justify-center rounded-full bg-card"><Icon name="remove" size={18} color="#2E2419" /></Pressable>
        <Text className="text-base font-bold text-ink" style={{ minWidth: 68, textAlign: "center" }}>{value}</Text>
        <Pressable onPress={onInc} accessibilityLabel={`Increase ${label}`} className="h-9 w-9 items-center justify-center rounded-full bg-card"><Icon name="add" size={18} color="#2E2419" /></Pressable>
      </HStack>
    </HStack>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <View className="rounded-2xl bg-card p-4" style={[{ gap: 16 }, ELEVATION.medium]}>{children}</View>;
}

/**
 * The preferences surface — declarative, not explanatory: the user sets what they want;
 * the copy doesn't teach how the ranking uses it (per Jordan's review). Cards are grouped
 * by kind (allergies / diet / kitchen, then tastes) with spacing, not headers. Operable
 * controls hold local draft state (no live re-rank in the prototype; see docs/swipe-ui/DESIGN.md).
 */
export function SettingsScreen({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [p, setP] = React.useState<Preferences>(DEFAULT_PREFERENCES);

  // Reset the draft each time the sheet opens.
  React.useEffect(() => { if (visible) setP(DEFAULT_PREFERENCES); }, [visible]);

  const track = (control: string, from: unknown, to: unknown, kind: "soft" | "hard") =>
    analytics.track("Settings Preference Changed", { control, from, to, kind });

  const setWeight = (key: keyof Weights, v: number) => {
    track(`weight.${key}`, p.weights[key], v, "soft");
    setP((s) => ({ ...s, weights: { ...s.weights, [key]: v } }));
  };
  const toggle = <K extends "likedCuisines" | "dislikedIngredients" | "ownedEquipment">(key: K, item: string, kind: "soft" | "hard") => {
    setP((s) => {
      const has = s[key].includes(item);
      track(key, has ? "on" : "off", has ? "off" : "on", kind);
      return { ...s, [key]: has ? s[key].filter((x) => x !== item) : [...s[key], item] } as Preferences;
    });
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View className="flex-1 justify-end" style={{ backgroundColor: "rgba(0,0,0,0.3)" }}>
        <View className="overflow-hidden rounded-t-3xl bg-cream" style={{ height: "92%" }}>
          <SafeAreaView edges={["bottom"]} style={{ flex: 1 }}>
            <HStack className="items-center justify-between px-5 pb-2 pt-4">
              <Text className="text-xl text-ink" style={{ fontFamily: "Karla_700Bold" }}>Your preferences</Text>
              <Pressable onPress={onClose} accessibilityLabel="Close preferences" className="rounded-full bg-card p-2"><Icon name="close" size={20} color="#2E2419" /></Pressable>
            </HStack>

            <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 8, gap: 28 }}>
              {/* Grouped by spacing, not explanatory headers — declarative: set what you want, no algorithm lesson. */}
              <VStack space={14}>
                <Card>
                  <Text className="text-sm font-bold text-ink">Allergies</Text>
                  {p.allergens.map((a) => (
                    <VStack key={a.allergen} space={8}>
                      <HStack className="items-center justify-between">
                        <Text className="text-base capitalize text-ink">{a.allergen}</Text>
                        <Pressable onPress={() => setP((s) => ({ ...s, allergens: s.allergens.filter((x) => x.allergen !== a.allergen) }))} accessibilityLabel={`Remove ${a.allergen}`}><Icon name="trash-outline" size={18} color="#6E5B48" /></Pressable>
                      </HStack>
                      <Segmented
                        label={`${a.allergen} severity`}
                        value={a.severity}
                        onChange={(sev) => { track(`allergen.${a.allergen}`, a.severity, sev, "hard"); setP((s) => ({ ...s, allergens: s.allergens.map((x) => x.allergen === a.allergen ? { ...x, severity: sev } : x) })); }}
                        options={[{ label: "Mild", value: "mild" }, { label: "Moderate", value: "moderate" }, { label: "Severe", value: "severe" }]}
                      />
                    </VStack>
                  ))}
                  <View className="flex-row flex-wrap" style={{ gap: 8, marginTop: 8 }}>
                    {ALLERGENS.filter((a) => !p.allergens.some((x) => x.allergen === a)).map((a) => (
                      <Chip key={a} label={`+ ${a}`} active={false} onToggle={() => { track(`allergen.${a}`, "off", "moderate", "hard"); setP((s) => ({ ...s, allergens: [...s.allergens, { allergen: a, severity: "moderate" }] })); }} />
                    ))}
                  </View>
                </Card>

                <Card>
                  <Text className="text-sm font-bold text-ink">Diet</Text>
                  {p.diets.map((d) => (
                    <VStack key={d.diet} space={8}>
                      <HStack className="items-center justify-between">
                        <Text className="text-base text-ink">{d.diet}</Text>
                        <HStack className="items-center" space={10}>
                          <View style={{ width: 170 }}>
                            <Segmented
                              label={`${d.diet} strictness`}
                              value={d.strictness}
                              onChange={(st) => { track(`diet.${d.diet}`, d.strictness, st, "hard"); setP((s) => ({ ...s, diets: s.diets.map((x) => x.diet === d.diet ? { ...x, strictness: st } : x) })); }}
                              options={[{ label: "Flexible", value: "flexible" }, { label: "Strict", value: "strict" }]}
                            />
                          </View>
                          <Pressable onPress={() => setP((s) => ({ ...s, diets: s.diets.filter((x) => x.diet !== d.diet) }))} accessibilityLabel={`Remove ${d.diet}`}><Icon name="trash-outline" size={18} color="#6E5B48" /></Pressable>
                        </HStack>
                      </HStack>
                    </VStack>
                  ))}
                  <View className="flex-row flex-wrap" style={{ gap: 8, marginTop: 8 }}>
                    {DIETS.filter((dt) => !p.diets.some((x) => x.diet === dt)).map((dt) => (
                      <Chip key={dt} label={`+ ${dt}`} active={false} onToggle={() => { track(`diet.${dt}`, "off", "flexible", "hard"); setP((s) => ({ ...s, diets: [...s.diets, { diet: dt, strictness: "flexible" }] })); }} />
                    ))}
                  </View>
                </Card>

                <Card>
                  <Text className="text-sm font-bold text-ink">My kitchen</Text>
                  <View className="flex-row flex-wrap" style={{ gap: 8, marginTop: 8 }}>
                    {EQUIPMENT.map((e) => <Chip key={e.type} label={e.label} active={p.ownedEquipment.includes(e.type)} onToggle={() => toggle("ownedEquipment", e.type, "hard")} />)}
                  </View>
                </Card>
              </VStack>

              <VStack space={14}>
                <Card>
                  {WEIGHT_QUESTIONS.map((w) => (
                    <VStack key={w.key} space={8}>
                      <Text className="text-base text-ink">{w.q}</Text>
                      <Segmented label={w.q} value={p.weights[w.key]} onChange={(v) => setWeight(w.key, v)} options={IMPORTANCE} />
                    </VStack>
                  ))}
                </Card>

                <Card>
                  <VStack space={8}>
                    <Text className="text-base text-ink">Your skill level</Text>
                    <Segmented
                      label="Skill level"
                      value={p.skillLevel}
                      onChange={(v) => { track("skillLevel", p.skillLevel, v, "soft"); setP((s) => ({ ...s, skillLevel: v as DifficultyBand })); }}
                      options={[{ label: "Beginner", value: "beginner" }, { label: "Intermediate", value: "intermediate" }, { label: "Advanced", value: "advanced" }]}
                    />
                  </VStack>
                  <Stepper label="Budget per serving" value={money(p.budgetCents)} onDec={() => setP((s) => ({ ...s, budgetCents: Math.max(100, s.budgetCents - 50) }))} onInc={() => setP((s) => ({ ...s, budgetCents: s.budgetCents + 50 }))} />
                  <Stepper label="Time budget" value={formatTime(p.timeBudgetMin)} onDec={() => setP((s) => ({ ...s, timeBudgetMin: Math.max(10, s.timeBudgetMin - 5) }))} onInc={() => setP((s) => ({ ...s, timeBudgetMin: s.timeBudgetMin + 5 }))} />
                </Card>

                <Card>
                  <Text className="text-sm font-bold text-ink">Cuisines you like</Text>
                  <View className="flex-row flex-wrap" style={{ gap: 8 }}>
                    {CUISINES.map((c) => <Chip key={c} label={c} active={p.likedCuisines.includes(c)} onToggle={() => toggle("likedCuisines", c, "soft")} />)}
                  </View>
                </Card>

                <Card>
                  <Text className="text-sm font-bold text-ink">Ingredients to avoid</Text>
                  <View className="flex-row flex-wrap" style={{ gap: 8 }}>
                    {COMMON_INGREDIENTS.map((i) => <Chip key={i} label={i} active={p.dislikedIngredients.includes(i)} onToggle={() => toggle("dislikedIngredients", i, "soft")} />)}
                  </View>
                </Card>
              </VStack>

              <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Save preferences" className="items-center rounded-full bg-brand py-3.5">
                <Text className="text-base font-bold text-white">Save</Text>
              </Pressable>
            </ScrollView>
          </SafeAreaView>
        </View>
      </View>
    </Modal>
  );
}
