import React from "react";
import { Modal, View, PanResponder, TextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ScrollView, VStack, HStack, Text, Pressable, Icon } from "../ui";
import { analytics } from "../../lib/analytics";
import { ELEVATION } from "../../lib/elevation";
import { MealCounts } from "../planner/MealPlanIntake";
import {
  Preferences, DEFAULT_PREFERENCES, COMMON_INGREDIENTS, money, formatTime, DifficultyBand, MealType,
} from "./mock";

const CUISINES =["Italian", "Thai", "Mexican", "Indian", "Japanese", "Mediterranean", "Chinese", "French"];
// Larger corpus the "＋ More" search draws from (the preset chips + the long tail).
const ALL_CUISINES = [...CUISINES, "Korean", "Vietnamese", "Spanish", "Greek", "Lebanese", "Turkish", "Ethiopian", "Peruvian", "Brazilian", "Caribbean", "Moroccan", "Filipino", "Malaysian", "Indonesian", "Portuguese", "German", "British", "American", "Tex-Mex", "Cajun", "Middle Eastern", "Soul food", "Nordic", "Argentine"];
const ALL_INGREDIENTS = ["Cilantro", "Mushrooms", "Olives", "Blue cheese", "Anchovies", "Bell peppers", "Coconut", "Tofu", "Eggplant", "Liver", "Capers", "Raisins", "Onions", "Garlic", "Ginger", "Fennel", "Beets", "Cumin", "Pickles", "Sardines", "Oysters", "Lamb", "Goat cheese", "Cottage cheese", "Tahini", "Miso", "Cabbage", "Brussels sprouts", "Okra", "Turnip", "Cauliflower", "Kimchi"];
const ALLERGENS = ["peanut", "tree nut", "milk", "egg", "soy", "wheat", "fish", "shellfish"];
const DIETS = ["Vegetarian", "Vegan", "Pescatarian", "Gluten-free", "Keto", "Paleo", "Dairy-free"];
const EQUIPMENT = [
  { type: "air_fryer", label: "Air fryer" }, { type: "slow_cooker", label: "Slow cooker" },
  { type: "pressure_cooker", label: "Pressure cooker" }, { type: "blender", label: "Blender" },
  { type: "stand_mixer", label: "Stand mixer" }, { type: "grill", label: "Grill" },
];
// The preset chips + the long tail the "More…" search draws from. These are the server's canonical
// EQUIPMENT_TYPES (server/src/schema.ts) — the client no longer offers types the server can't store.
const ALL_EQUIPMENT = [
  ...EQUIPMENT,
  { type: "food_processor", label: "Food processor" }, { type: "dutch_oven", label: "Dutch oven" },
  { type: "deep_fryer", label: "Deep fryer" }, { type: "wok", label: "Wok" },
  { type: "sous_vide", label: "Sous-vide" }, { type: "smoker", label: "Smoker" },
  { type: "ice_cream_maker", label: "Ice cream maker" }, { type: "waffle_iron", label: "Waffle iron" },
];
const EQUIP_TYPE_TO_LABEL = Object.fromEntries(ALL_EQUIPMENT.map((e) => [e.type, e.label]));
const EQUIP_LABEL_TO_TYPE = Object.fromEntries(ALL_EQUIPMENT.map((e) => [e.label, e.type]));

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

/** A drag/tap slider — the value shows above; the filled track + thumb use the brand. */
function Slider({ value, min, max, step, format, onChange }: { value: number; min: number; max: number; step: number; format: (v: number) => string; onChange: (v: number) => void }) {
  const [w, setW] = React.useState(0);
  const pct = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const wRef = React.useRef(0);
  wRef.current = w;
  // Keep the setter in a ref so the once-created PanResponder always calls the latest onChange.
  const applyRef = React.useRef<(x: number) => void>(() => {});
  applyRef.current = (x: number) => {
    const width = wRef.current;
    if (!width) return;
    const snapped = Math.round((min + (x / width) * (max - min)) / step) * step;
    onChange(Math.max(min, Math.min(max, snapped)));
  };
  const pan = React.useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => applyRef.current(e.nativeEvent.locationX),
      onPanResponderMove: (e) => applyRef.current(e.nativeEvent.locationX),
    }),
  ).current;
  return (
    <VStack space={8}>
      <Text className="text-base font-bold text-brand" style={{ alignSelf: "flex-end" }}>{format(value)}</Text>
      <View {...pan.panHandlers} onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ height: 40, justifyContent: "center" }} accessibilityRole="adjustable">
        <View className="rounded-full bg-sand" style={{ height: 8 }} />
        <View className="absolute rounded-full bg-brand" style={{ left: 0, top: 16, height: 8, width: `${pct * 100}%` }} />
        <View className="absolute rounded-full bg-brand" style={[{ top: 8, left: `${pct * 100}%`, marginLeft: -12, height: 24, width: 24 }, ELEVATION.low]} />
      </View>
    </VStack>
  );
}

/**
 * A "More…" search action. Hollow (no fill) with a neutral border so it reads as a secondary
 * *action*, not a value — value chips are always filled, a selected one brand-filled, so an
 * unfilled neutral pill can't be mistaken for either. (Per Jordan's review it must not share the
 * selected-chip affordance.)
 */
function MoreChip({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel="Search for more" className="flex-row items-center rounded-full px-3.5 py-2" style={{ borderWidth: 1, borderColor: "#C2A678", gap: 4 }}>
      <Icon name="search" size={14} color="#6E5B48" />
      <Text className="text-sm font-semibold text-muted">More…</Text>
    </Pressable>
  );
}

/** A search sheet to add options from a larger corpus (tap a result to toggle it). */
function SearchAddSheet({ visible, title, corpus, selected, onToggle, onClose }: { visible: boolean; title: string; corpus: string[]; selected: string[]; onToggle: (item: string) => void; onClose: () => void }) {
  const [q, setQ] = React.useState("");
  React.useEffect(() => { if (visible) setQ(""); }, [visible]);
  const results = corpus.filter((o) => o.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View className="flex-1 justify-end" style={{ backgroundColor: "rgba(0,0,0,0.3)" }}>
        <View className="rounded-t-3xl bg-cream" style={{ maxHeight: "80%" }}>
          <SafeAreaView edges={["bottom"]}>
            <HStack className="items-center justify-between px-5 pb-3 pt-4">
              <Text className="text-lg text-ink" style={{ fontFamily: "Karla_700Bold" }}>{title}</Text>
              <Pressable onPress={onClose} accessibilityLabel="Close" className="rounded-full bg-card p-2" style={ELEVATION.low}><Icon name="close" size={18} color="#2E2419" /></Pressable>
            </HStack>
            <View className="px-5 pb-3">
              <TextInput value={q} onChangeText={setQ} placeholder="Search…" placeholderTextColor="#9C8460" autoFocus className="rounded-xl bg-card px-4 py-3 text-ink" style={{ fontFamily: "Karla_400Regular" }} />
            </View>
            <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 12 }}>
              <View className="flex-row flex-wrap" style={{ gap: 8 }}>
                {results.map((o) => <Chip key={o} label={o} active={selected.includes(o)} onToggle={() => onToggle(o)} />)}
                {results.length === 0 ? <Text className="text-sm text-muted">No matches for “{q}”.</Text> : null}
              </View>
            </ScrollView>
          </SafeAreaView>
        </View>
      </View>
    </Modal>
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
export function SettingsContent({ onClose, embedded = false, initial = DEFAULT_PREFERENCES, onSave }: { onClose: () => void; embedded?: boolean; initial?: Preferences; onSave?: (p: Preferences) => void }) {
  const [p, setP] = React.useState<Preferences>(initial);
  const [cuisineSearch, setCuisineSearch] = React.useState(false);
  const [ingredientSearch, setIngredientSearch] = React.useState(false);
  const [equipmentSearch, setEquipmentSearch] = React.useState(false);
  // Preset chips plus anything the user added via search, so added options stay visible.
  const cuisineChips = Array.from(new Set([...CUISINES, ...p.likedCuisines]));
  const ingredientChips = Array.from(new Set([...COMMON_INGREDIENTS, ...p.dislikedIngredients]));
  const equipmentChips = Array.from(new Set([...EQUIPMENT.map((e) => e.type), ...p.ownedEquipment]));

  const track = (control: string, from: unknown, to: unknown, kind: "soft" | "hard") =>
    analytics.track("Settings Preference Changed", { control, from, to, kind });

  const setMeal = (m: MealType, v: number) => {
    track(`meals.${m}`, p.weeklyMeals[m], v, "soft");
    setP((s) => ({ ...s, weeklyMeals: { ...s.weeklyMeals, [m]: v } }));
  };
  const toggle =<K extends "likedCuisines" | "dislikedIngredients" | "ownedEquipment">(key: K, item: string, kind: "soft" | "hard") => {
    setP((s) => {
      const has = s[key].includes(item);
      track(key, has ? "on" : "off", has ? "off" : "on", kind);
      return { ...s, [key]: has ? s[key].filter((x) => x !== item) : [...s[key], item] } as Preferences;
    });
  };

  const body = (
    <>
              {/* Most-likely-to-change first, each its own card. */}
              <VStack space={14}>
                <MealCounts value={p.weeklyMeals} onChange={setMeal} />
                <Card>
                  <Text className="text-sm font-bold text-ink">Weekly grocery budget</Text>
                  <Slider value={p.weeklyBudgetCents} min={3000} max={40000} step={1000} format={(c) => `${money(c)} / week`} onChange={(v) => setP((s) => ({ ...s, weeklyBudgetCents: v }))} />
                </Card>
                <Card>
                  <Text className="text-sm font-bold text-ink">Time per meal</Text>
                  <Slider value={p.timeBudgetMin} min={10} max={120} step={5} format={(m) => formatTime(m)} onChange={(v) => setP((s) => ({ ...s, timeBudgetMin: v }))} />
                </Card>
                <Card>
                  <Text className="text-sm font-bold text-ink">Your skill level</Text>
                  <Segmented label="Skill level" value={p.skillLevel} onChange={(v) => { track("skillLevel", p.skillLevel, v, "soft"); setP((s) => ({ ...s, skillLevel: v as DifficultyBand })); }} options={[{ label: "Beginner", value: "beginner" }, { label: "Intermediate", value: "intermediate" }, { label: "Advanced", value: "advanced" }]} />
                </Card>
              </VStack>

              {/* Filters */}
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
                    {equipmentChips.map((t) => <Chip key={t} label={EQUIP_TYPE_TO_LABEL[t] ?? t} active={p.ownedEquipment.includes(t)} onToggle={() => toggle("ownedEquipment", t, "hard")} />)}
                    <MoreChip onPress={() => setEquipmentSearch(true)} />
                  </View>
                </Card>
              </VStack>

              <VStack space={14}>
                <Card>
                  <Text className="text-sm font-bold text-ink">Cuisines you like</Text>
                  <View className="flex-row flex-wrap" style={{ gap: 8 }}>
                    {cuisineChips.map((c) => <Chip key={c} label={c} active={p.likedCuisines.includes(c)} onToggle={() => toggle("likedCuisines", c, "soft")} />)}
                    <MoreChip onPress={() => setCuisineSearch(true)} />
                  </View>
                </Card>

                <Card>
                  <Text className="text-sm font-bold text-ink">Ingredients to avoid</Text>
                  <View className="flex-row flex-wrap" style={{ gap: 8 }}>
                    {ingredientChips.map((i) => <Chip key={i} label={i} active={p.dislikedIngredients.includes(i)} onToggle={() => toggle("dislikedIngredients", i, "soft")} />)}
                    <MoreChip onPress={() => setIngredientSearch(true)} />
                  </View>
                </Card>
              </VStack>

              <Pressable onPress={() => { onSave?.(p); onClose(); }} accessibilityRole="button" accessibilityLabel="Save preferences" className="items-center rounded-full bg-brand py-3.5">
                <Text className="text-base font-bold text-white">Save</Text>
              </Pressable>

              <SearchAddSheet visible={cuisineSearch} title="Add a cuisine" corpus={ALL_CUISINES} selected={p.likedCuisines} onToggle={(c) => toggle("likedCuisines", c, "soft")} onClose={() => setCuisineSearch(false)} />
              <SearchAddSheet visible={ingredientSearch} title="Add an ingredient to avoid" corpus={ALL_INGREDIENTS} selected={p.dislikedIngredients} onToggle={(i) => toggle("dislikedIngredients", i, "soft")} onClose={() => setIngredientSearch(false)} />
              <SearchAddSheet visible={equipmentSearch} title="Add kitchen equipment" corpus={ALL_EQUIPMENT.map((e) => e.label)} selected={p.ownedEquipment.map((t) => EQUIP_TYPE_TO_LABEL[t]).filter(Boolean)} onToggle={(label) => toggle("ownedEquipment", EQUIP_LABEL_TO_TYPE[label], "hard")} onClose={() => setEquipmentSearch(false)} />
    </>
  );

  // Flat layout (studio preview) — no inner scroll, so the studio's outer ScrollView moves the
  // content AND its comment pins together; a pin anchored to a scrolling viewport would drift.
  if (embedded) {
    return <View style={{ padding: 20 }}><VStack space={28}>{body}</VStack></View>;
  }

  return (
    <SafeAreaView edges={["bottom"]} style={{ flex: 1 }}>
      <HStack className="items-center justify-between px-5 pb-2 pt-4">
        <Text className="text-xl text-ink" style={{ fontFamily: "Karla_700Bold" }}>Your preferences</Text>
        <Pressable onPress={onClose} accessibilityLabel="Close preferences" className="rounded-full bg-card p-2"><Icon name="close" size={20} color="#2E2419" /></Pressable>
      </HStack>
      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 8, gap: 28 }}>
        {body}
      </ScrollView>
    </SafeAreaView>
  );
}

/** The deck's gear opens this — the settings content in a bottom-sheet Modal. */
export function SettingsScreen({ visible, onClose, initial, onSave }: { visible: boolean; onClose: () => void; initial?: Preferences; onSave?: (p: Preferences) => void }) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View className="flex-1 justify-end" style={{ backgroundColor: "rgba(0,0,0,0.3)" }}>
        <View className="overflow-hidden rounded-t-3xl bg-cream" style={{ height: "92%" }}>
          {visible ? <SettingsContent onClose={onClose} initial={initial} onSave={onSave} /> : null}
        </View>
      </View>
    </Modal>
  );
}
