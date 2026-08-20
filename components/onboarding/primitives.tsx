import React from "react";
import { Modal, View, PanResponder, TextInput, AccessibilityInfo } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { ScrollView, VStack, HStack, Text, Pressable, Icon } from "../ui";
import { ELEVATION } from "../../lib/elevation";
import { BRAND_GRADIENT } from "../../lib/gradient";
import { revealCount } from "../../lib/typewriter";

/**
 * Shared onboarding + settings building blocks. These were lifted verbatim from
 * components/swipe/SettingsScreen.tsx so the two surfaces stay pixel-identical —
 * a chip in onboarding and the same chip in Settings must never drift. Everything
 * here is controlled + presentational (Refactoring UI Ch1: reuse one system).
 */

/* ---------- Selection controls ---------- */

/** Single-select pill row — active = solid brand + white (AGENTS.md selection rule). */
export function Segmented<T extends string | number>({ options, value, onChange, label }: { options: { label: string; value: T }[]; value: T; onChange: (v: T) => void; label?: string }) {
  return (
    <View className="flex-row rounded-full bg-sand p-1" style={{ gap: 2 }} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            onPress={() => { Haptics.selectionAsync().catch(() => {}); onChange(o.value); }}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            accessibilityLabel={o.label}
            className="flex-1 overflow-hidden rounded-full"
            style={active ? ELEVATION.low : undefined}
          >
            {active ? (
              <LinearGradient colors={BRAND_GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={{ paddingVertical: 6, alignItems: "center", borderRadius: 999 }}>
                <Text className="text-xs font-bold text-white">{o.label}</Text>
              </LinearGradient>
            ) : (
              <View className="items-center py-1.5">
                <Text className="text-xs font-bold text-muted">{o.label}</Text>
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * Multi-select chip — one brand family, two harmonious states (design decision, chip options v4):
 * resting = an outline on the canvas (`bg-card` + brand border + brand-dark text); selected = the
 * gentle brand gradient fill + white text. Both clear WCAG AA. The "+ add" chips (allergies/diet)
 * use the resting look — no separate variant.
 */
export function Chip({ label, active, onToggle }: { label: string; active: boolean; onToggle: () => void }) {
  const tap = () => { Haptics.selectionAsync().catch(() => {}); onToggle(); };
  if (active) {
    return (
      <Pressable onPress={tap} accessibilityRole="button" accessibilityState={{ selected: true }} accessibilityLabel={label} className="overflow-hidden rounded-full" style={ELEVATION.low}>
        <LinearGradient colors={BRAND_GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={{ paddingHorizontal: 14, paddingVertical: 8 }}>
          <Text className="text-sm font-semibold text-white">{label}</Text>
        </LinearGradient>
      </Pressable>
    );
  }
  // Resting = a brand outline with a transparent fill, so the chip shows the page background (cream),
  // not a near-white pill. Border via className so it survives the Pressable's style merge.
  return (
    <Pressable onPress={tap} accessibilityRole="button" accessibilityState={{ selected: false }} accessibilityLabel={label} className="rounded-full border border-brand bg-transparent px-3.5 py-2">
      <Text className="text-sm font-semibold" style={{ color: "#8A4A1E" }}>{label}</Text>
    </Pressable>
  );
}

/** A "More…" search action — hollow neutral pill so it can't be mistaken for a value chip. */
export function MoreChip({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); onPress(); }} accessibilityRole="button" accessibilityLabel="Search for more" className="flex-row items-center rounded-full border border-brand bg-transparent px-3.5 py-2" style={{ gap: 5 }}>
      <Icon name="search" size={14} color="#8A4A1E" />
      <Text className="text-sm font-semibold" style={{ color: "#8A4A1E" }}>More…</Text>
    </Pressable>
  );
}

/**
 * A −n+ counter where the number is the hero. `big` lifts the numeral to the
 * onboarding display size (adults/kids); default matches the settings MealCounts.
 */
export function Stepper({ value, onChange, min = 0, max = 21, label, big = false }: { value: number; onChange: (v: number) => void; min?: number; max?: number; label: string; big?: boolean }) {
  const StepBtn = ({ dir, disabled }: { dir: "down" | "up"; disabled: boolean }) => (
    <Pressable
      onPress={() => onChange(dir === "up" ? Math.min(max, value + 1) : Math.max(min, value - 1))}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={`${dir === "up" ? "More" : "Fewer"} ${label}`}
      hitSlop={8}
      className="items-center justify-center rounded-full bg-sand-200"
      style={[big ? { width: 40, height: 40 } : { width: 30, height: 30 }, disabled ? { opacity: 0.35 } : undefined]}
    >
      <Icon name={dir === "up" ? "add" : "remove"} size={big ? 20 : 16} color="#6E5B48" />
    </Pressable>
  );
  return (
    <HStack className="items-center" space={big ? 18 : 12}>
      <StepBtn dir="down" disabled={value <= min} />
      <Text className={`${big ? "text-5xl" : "text-2xl"} ${value > 0 ? "text-ink" : "text-sand-400"}`} style={{ fontFamily: "Karla_700Bold", minWidth: big ? 56 : 28, textAlign: "center" }}>{value}</Text>
      <StepBtn dir="up" disabled={value >= max} />
    </HStack>
  );
}

/** Drag/tap slider — value shows above (unless hidden), filled track + thumb use brand. */
export function Slider({ value, min, max, step, format, onChange, hideValue = false }: { value: number; min: number; max: number; step: number; format: (v: number) => string; onChange: (v: number) => void; hideValue?: boolean }) {
  const [w, setW] = React.useState(0);
  const pct = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const wRef = React.useRef(0);
  wRef.current = w;
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
      {hideValue ? null : <Text className="text-base font-bold text-brand" style={{ alignSelf: "flex-end" }}>{format(value)}</Text>}
      <View {...pan.panHandlers} onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ height: 40, justifyContent: "center" }} accessibilityRole="adjustable">
        <View className="rounded-full bg-sand" style={{ height: 8 }} />
        <LinearGradient colors={BRAND_GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ position: "absolute", left: 0, top: 16, height: 8, borderRadius: 999, width: `${pct * 100}%` }} />
        <View className="absolute" style={[{ top: 8, left: `${pct * 100}%`, marginLeft: -12, height: 24, width: 24, borderRadius: 999 }, ELEVATION.low]}>
          <LinearGradient colors={BRAND_GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={{ height: 24, width: 24, borderRadius: 999 }} />
        </View>
      </View>
    </VStack>
  );
}

/** A search sheet to add options from a larger corpus (tap a result to toggle it). */
export function SearchAddSheet({ visible, title, corpus, selected, onToggle, onClose }: { visible: boolean; title: string; corpus: string[]; selected: string[]; onToggle: (item: string) => void; onClose: () => void }) {
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

/** Lifted card container — bg-card + ELEVATION.medium, the settings/onboarding surface. */
export function Card({ children }: { children: React.ReactNode }) {
  return <View className="rounded-2xl bg-card p-4" style={[{ gap: 16 }, ELEVATION.medium]}>{children}</View>;
}

/* ---------- Typewriter (informational cards only) ---------- */

/**
 * Types `text` character-by-character with a light haptic tick, then fires onDone.
 * Informational screens only — never gate an answer behind an animation. Honours OS
 * Reduce Motion (renders the whole string instantly, no ticks). Uses the JS timer,
 * not the native driver, so a fresh mount doesn't stall (docs/rn-nativewind-pitfalls.md).
 */
export function Typewriter({ text, msPerChar = 28, haptics = true, onDone, style, className }: { text: string; msPerChar?: number; haptics?: boolean; onDone?: () => void; style?: object; className?: string }) {
  const [n, setN] = React.useState(0);
  const [reduce, setReduce] = React.useState(false);
  const start = React.useRef(0);
  const doneRef = React.useRef(onDone);
  doneRef.current = onDone;
  // Lazily require expo-haptics so the pure component stays testable and web-safe.
  const tick = React.useRef<() => void>(() => {});
  React.useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then((r) => { if (!cancelled) setReduce(r); }).catch(() => {});
    if (haptics) {
      import("expo-haptics").then((H) => { tick.current = () => H.selectionAsync().catch(() => {}); }).catch(() => {});
    }
    return () => { cancelled = true; };
  }, [haptics]);

  React.useEffect(() => {
    setN(0);
    start.current = Date.now();
    if (reduce || msPerChar <= 0) { setN(text.length); doneRef.current?.(); return; }
    let raf: ReturnType<typeof setInterval>;
    let last = 0;
    raf = setInterval(() => {
      const shown = revealCount(Date.now() - start.current, msPerChar, text.length, false);
      setN(shown);
      if (haptics && shown > last && shown % 2 === 0) tick.current();
      last = shown;
      if (shown >= text.length) { clearInterval(raf); doneRef.current?.(); }
    }, msPerChar);
    return () => clearInterval(raf);
  }, [text, msPerChar, reduce, haptics]);

  return <Text className={className} style={style}>{text.slice(0, n)}</Text>;
}

/* ---------- Canonical option corpora (shared with SettingsScreen) ---------- */

export const CUISINES = ["Italian", "Thai", "Mexican", "Indian", "Japanese", "Mediterranean", "Chinese", "French"];
export const ALL_CUISINES = [...CUISINES, "Korean", "Vietnamese", "Spanish", "Greek", "Lebanese", "Turkish", "Ethiopian", "Peruvian", "Brazilian", "Caribbean", "Moroccan", "Filipino", "Malaysian", "Indonesian", "Portuguese", "German", "British", "American", "Tex-Mex", "Cajun", "Middle Eastern", "Soul food", "Nordic", "Argentine"];
export const ALL_INGREDIENTS = ["Cilantro", "Mushrooms", "Olives", "Blue cheese", "Anchovies", "Bell peppers", "Coconut", "Tofu", "Eggplant", "Liver", "Capers", "Raisins", "Onions", "Garlic", "Ginger", "Fennel", "Beets", "Cumin", "Pickles", "Sardines", "Oysters", "Lamb", "Goat cheese", "Cottage cheese", "Tahini", "Miso", "Cabbage", "Brussels sprouts", "Okra", "Turnip", "Cauliflower", "Kimchi"];
export const ALLERGENS = ["peanut", "tree nut", "milk", "egg", "soy", "wheat", "fish", "shellfish"];
export const DIETS = ["Vegetarian", "Vegan", "Pescatarian", "Gluten-free", "Keto", "Paleo", "Dairy-free"];
export const EQUIPMENT = [
  { type: "air_fryer", label: "Air fryer" }, { type: "slow_cooker", label: "Slow cooker" },
  { type: "pressure_cooker", label: "Pressure cooker" }, { type: "blender", label: "Blender" },
  { type: "stand_mixer", label: "Stand mixer" }, { type: "grill", label: "Grill" },
];
// The preset chips + the long tail — the server's canonical EQUIPMENT_TYPES (server/src/schema.ts).
export const ALL_EQUIPMENT = [
  ...EQUIPMENT,
  { type: "food_processor", label: "Food processor" }, { type: "dutch_oven", label: "Dutch oven" },
  { type: "deep_fryer", label: "Deep fryer" }, { type: "wok", label: "Wok" },
  { type: "sous_vide", label: "Sous-vide" }, { type: "smoker", label: "Smoker" },
  { type: "ice_cream_maker", label: "Ice cream maker" }, { type: "waffle_iron", label: "Waffle iron" },
];
export const EQUIP_TYPE_TO_LABEL: Record<string, string> = Object.fromEntries(ALL_EQUIPMENT.map((e) => [e.type, e.label]));
export const EQUIP_LABEL_TO_TYPE: Record<string, string> = Object.fromEntries(ALL_EQUIPMENT.map((e) => [e.label, e.type]));

/**
 * Proposed grocery-store corpus (DESIGN.md E1) — a curated top of US chains for v1, each with its
 * brand colour so a tile self-labels. Client-side for the prototype; becomes a server GROCERY_STORES
 * enum in Phase 2. `color` is the store's brand, quarantined inside its tile (Ch5).
 */
// The curated grid — the most-common chains, each with a bundled real logo (Wegmans uses a monogram).
export const GROCERY_STORES: { id: string; label: string; color: string }[] = [
  { id: "walmart", label: "Walmart", color: "#0071CE" },
  { id: "target", label: "Target", color: "#CC0000" },
  { id: "kroger", label: "Kroger", color: "#004990" },
  { id: "costco", label: "Costco", color: "#E31837" },
  { id: "aldi", label: "Aldi", color: "#00447C" },
  { id: "safeway", label: "Safeway", color: "#D4002A" },
  { id: "publix", label: "Publix", color: "#007A3E" },
  { id: "whole_foods", label: "Whole Foods", color: "#00674B" },
  { id: "trader_joes", label: "Trader Joe's", color: "#B02318" },
  { id: "wegmans", label: "Wegmans", color: "#C8102E" },
  { id: "heb", label: "H-E-B", color: "#E2231A" },
  { id: "albertsons", label: "Albertsons", color: "#0A4595" },
  { id: "meijer", label: "Meijer", color: "#00539B" },
  { id: "food_lion", label: "Food Lion", color: "#C8102E" },
  { id: "harris_teeter", label: "Harris Teeter", color: "#00953B" },
  { id: "sprouts", label: "Sprouts", color: "#5B8F22" },
];
// The long tail the "More…" search draws from — all major US grocery chains. No logo needed (search
// renders text chips); if one is ever promoted into the grid it falls back to a brand-colour monogram.
const MORE_STORES: { id: string; label: string; color: string }[] = [
  { id: "sams_club", label: "Sam's Club", color: "#0067A0" },
  { id: "lidl", label: "Lidl", color: "#0050AA" },
  { id: "giant_food", label: "Giant Food", color: "#E4022D" },
  { id: "giant_eagle", label: "Giant Eagle", color: "#E11A2C" },
  { id: "stop_shop", label: "Stop & Shop", color: "#E4022D" },
  { id: "shoprite", label: "ShopRite", color: "#ED1C24" },
  { id: "winco", label: "WinCo Foods", color: "#003F87" },
  { id: "ralphs", label: "Ralphs", color: "#004990" },
  { id: "vons", label: "Vons", color: "#D4002A" },
  { id: "hyvee", label: "Hy-Vee", color: "#D2232A" },
  { id: "fred_meyer", label: "Fred Meyer", color: "#004990" },
  { id: "winn_dixie", label: "Winn-Dixie", color: "#E21836" },
  { id: "acme", label: "ACME Markets", color: "#C8102E" },
  { id: "jewel_osco", label: "Jewel-Osco", color: "#D4002A" },
  { id: "hannaford", label: "Hannaford", color: "#C8102E" },
  { id: "price_chopper", label: "Price Chopper", color: "#E31837" },
  { id: "market_basket", label: "Market Basket", color: "#005DAA" },
  { id: "raleys", label: "Raley's", color: "#E31837" },
  { id: "king_soopers", label: "King Soopers", color: "#004990" },
  { id: "frys", label: "Fry's", color: "#E11A2C" },
  { id: "food_4_less", label: "Food 4 Less", color: "#E21836" },
  { id: "smiths", label: "Smith's", color: "#004990" },
  { id: "dillons", label: "Dillons", color: "#004990" },
  { id: "weis", label: "Weis Markets", color: "#E31837" },
  { id: "bjs", label: "BJ's Wholesale", color: "#D31245" },
  { id: "grocery_outlet", label: "Grocery Outlet", color: "#F58220" },
  { id: "natural_grocers", label: "Natural Grocers", color: "#6CA439" },
  { id: "schnucks", label: "Schnucks", color: "#E31837" },
  { id: "tom_thumb", label: "Tom Thumb", color: "#D4002A" },
  { id: "cub_foods", label: "Cub Foods", color: "#E31837" },
  { id: "save_mart", label: "Save Mart", color: "#E11A2C" },
  { id: "stater_bros", label: "Stater Bros", color: "#003C71" },
  { id: "ingles", label: "Ingles Markets", color: "#E21836" },
  { id: "lowes_foods", label: "Lowes Foods", color: "#00843D" },
  { id: "brookshires", label: "Brookshire's", color: "#E31837" },
  { id: "food_city", label: "Food City", color: "#E4002B" },
  { id: "piggly_wiggly", label: "Piggly Wiggly", color: "#E21836" },
  { id: "kwik_trip", label: "Kwik Trip", color: "#E11A2C" },
  { id: "wakefern", label: "The Fresh Grocer", color: "#00843D" },
  { id: "sprouts_farmers", label: "Sprouts Farmers Market", color: "#5B8F22" },
];
export const ALL_GROCERY_STORES = [...GROCERY_STORES, ...MORE_STORES];
export const STORE_ID_TO_LABEL: Record<string, string> = Object.fromEntries(ALL_GROCERY_STORES.map((s) => [s.id, s.label]));
export const STORE_LABEL_TO_ID: Record<string, string> = Object.fromEntries(ALL_GROCERY_STORES.map((s) => [s.label, s.id]));

/** Bundled real store brand logos (fetched into assets/stores). The curated tiles render these;
 *  search-added stores fall back to a text chip. Store marks are used for store identification only. */
export const STORE_LOGOS: Record<string, number> = {
  walmart: require("../../assets/stores/walmart.png"),
  target: require("../../assets/stores/target.png"),
  kroger: require("../../assets/stores/kroger.png"),
  costco: require("../../assets/stores/costco.png"),
  aldi: require("../../assets/stores/aldi.png"),
  safeway: require("../../assets/stores/safeway.png"),
  publix: require("../../assets/stores/publix.png"),
  whole_foods: require("../../assets/stores/whole_foods.png"),
  trader_joes: require("../../assets/stores/trader_joes.png"),
  // wegmans: no clean brand mark freely available (its favicon is a generic glyph) — falls back to a
  // brand-colour monogram tile in OnboardingStorePicker.
  heb: require("../../assets/stores/heb.png"),
  albertsons: require("../../assets/stores/albertsons.png"),
  meijer: require("../../assets/stores/meijer.png"),
  food_lion: require("../../assets/stores/food_lion.png"),
  harris_teeter: require("../../assets/stores/harris_teeter.png"),
  sprouts: require("../../assets/stores/sprouts.png"),
};

/** Dish types — the third facet the combined taste picker offers alongside cuisines + ingredients. */
export const DISH_TYPES = ["Soups", "Salads", "Bowls", "Pasta", "Stir-fries", "Tacos", "Curries", "Sandwiches", "Pizza", "Roasts", "Stews", "Casseroles", "Grain bowls", "Wraps", "Burgers", "Noodles", "Dumplings", "Grilled", "Baked", "One-pot"];
/** One combined corpus for the taste screens — cuisines + dish types + ingredients in a single picker. */
export const TASTE_CORPUS = Array.from(new Set([...ALL_CUISINES, ...DISH_TYPES, ...ALL_INGREDIENTS]));

/** Which facet a taste label belongs to — cuisines first, then dish types, else ingredient (WI-1 wire facet). */
export function tasteFacet(label: string): "cuisine" | "dish_type" | "ingredient" {
  if (ALL_CUISINES.includes(label)) return "cuisine";
  if (DISH_TYPES.includes(label)) return "dish_type";
  return "ingredient";
}
/** The preset chips shown before "More…" — a spread across the three facets. */
export const TASTE_PRESETS = ["Italian", "Thai", "Mexican", "Japanese", "Bowls", "Pasta", "Stir-fries", "Tacos", "Chicken", "Salmon", "Tofu", "Mushrooms"];
