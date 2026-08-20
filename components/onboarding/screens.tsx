import React from "react";
import { View, Animated, Image } from "react-native";
import { VStack, HStack, Text, Pressable, Icon } from "../ui";
import { ELEVATION } from "../../lib/elevation";
import { DURATION, EASE } from "../../lib/motion";
import {
  Chip, Segmented, Slider, Stepper, MoreChip, SearchAddSheet, Card, Typewriter,
  GROCERY_STORES, ALL_GROCERY_STORES, STORE_ID_TO_LABEL, STORE_LABEL_TO_ID, STORE_LOGOS,
} from "./primitives";

/**
 * The onboarding screen-body archetypes — controlled, presentational, and shell-free.
 * Each is the *body* of one screen (the Phase-2 flow wraps it in the existing
 * components/recime/OnboardingScreen shell, which owns the horizontal padding + pinned CTA).
 * They compose the shared primitives so the onboarding chips/sliders/steppers are the exact ones
 * Settings ships. Golden-hour system throughout: bg-card surfaces, depth via ELEVATION (never tone),
 * one accent = one meaning, Reduce Motion honoured in every animated archetype.
 *
 * Two layout invariants keep the flow consistent (Refactoring UI Ch2/Ch3):
 *  - Every input screen opens with the shared <StepHeader> (one centered title/subtitle treatment).
 *  - Bodies never add horizontal padding — the shell (flow) or the studio Frame owns it, so every
 *    screen shares one inset instead of stacking paddings.
 */

type IoniconName = React.ComponentProps<typeof Icon>["name"];
const SELECTED_TILE = { borderWidth: 2, borderColor: "#A85E2B", backgroundColor: "#F3E0CC" } as const;
const RESTING_TILE = { borderWidth: 1, borderColor: "#E4D6BC" } as const;

/** The one centered title + subtitle every input step opens with — consistent size, weight, spacing. */
export function StepHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <VStack space={6} className="items-center" style={{ marginBottom: 24 }}>
      <Text className="text-center text-2xl text-ink" style={{ fontFamily: "Karla_700Bold", lineHeight: 30 }}>{title}</Text>
      {subtitle ? <Text className="text-center text-base text-muted">{subtitle}</Text> : null}
    </VStack>
  );
}

/* ── 1. Informational value card — typing + haptics (info screens only) ────────── */

export function OnboardingValueCard({ headline, body, art, typing = true, haptics = true, ctaLabel = "Continue", onContinue }: {
  headline: string; body?: string; art?: React.ReactNode; typing?: boolean; haptics?: boolean; ctaLabel?: string; onContinue?: () => void;
}) {
  const [showBody, setShowBody] = React.useState(!typing);
  const fade = React.useRef(new Animated.Value(typing ? 0 : 1)).current;
  React.useEffect(() => {
    if (showBody) Animated.timing(fade, { toValue: 1, duration: DURATION.medium, easing: EASE.smoothOut, useNativeDriver: false }).start();
  }, [showBody, fade]);
  return (
    <View style={{ paddingVertical: 24, minHeight: 440 }} className="items-center justify-center">
      <View className="items-center" style={{ gap: 20 }}>
        {art ? <View className="items-center">{art}</View> : null}
        {typing ? (
          <Typewriter text={headline} haptics={haptics} onDone={() => setShowBody(true)} className="text-center text-3xl text-ink" style={{ fontFamily: "Karla_700Bold", lineHeight: 40 }} />
        ) : (
          <Text className="text-center text-3xl text-ink" style={{ fontFamily: "Karla_700Bold", lineHeight: 40 }}>{headline}</Text>
        )}
        {body ? (
          <Animated.View style={{ opacity: fade }}>
            <Text className="text-center text-base text-muted" style={{ lineHeight: 22 }}>{body}</Text>
          </Animated.View>
        ) : null}
      </View>
      {/* Standalone (studio) shows its own CTA; inside the flow the OnboardingScreen shell owns the
          pinned, lg-sized CTA, so the card renders content only (no mid-screen button). */}
      {onContinue ? (
        <Pressable onPress={onContinue} accessibilityRole="button" accessibilityLabel={ctaLabel} className="mt-10 w-full items-center rounded-full bg-brand py-3.5" style={ELEVATION.medium}>
          <Text className="text-base font-bold text-white">{ctaLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/* ── 3. Chip grid — multi or single select (goals, time-bands, equipment) ───────── */

export function OnboardingChipGrid({ title, subtitle, options, value, onChange, multi = true, moreCorpus, moreTitle }: {
  title: string; subtitle?: string; options: { value: string; label: string }[]; value: string[]; onChange: (v: string[]) => void;
  multi?: boolean; moreCorpus?: string[]; moreTitle?: string;
}) {
  const [search, setSearch] = React.useState(false);
  const toggle = (v: string) => {
    if (multi) onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
    else onChange(value.includes(v) ? [] : [v]);
  };
  const labelFor = (v: string) => options.find((o) => o.value === v)?.label ?? v;
  const extra = value.filter((v) => !options.some((o) => o.value === v));
  return (
    <View style={{ paddingTop: 8 }}>
      <StepHeader title={title} subtitle={subtitle} />
      <View className="flex-row flex-wrap" style={{ gap: 8 }}>
        {options.map((o) => <Chip key={o.value} label={o.label} active={value.includes(o.value)} onToggle={() => toggle(o.value)} />)}
        {extra.map((v) => <Chip key={v} label={labelFor(v)} active onToggle={() => toggle(v)} />)}
        {moreCorpus ? <MoreChip onPress={() => setSearch(true)} /> : null}
      </View>
      {moreCorpus ? (
        <SearchAddSheet visible={search} title={moreTitle ?? "Add more"} corpus={moreCorpus} selected={value} onToggle={toggle} onClose={() => setSearch(false)} />
      ) : null}
    </View>
  );
}

/* ── 4. Store picker — real-brand tiles, our accent marks the choice ───────────── */

export function OnboardingStorePicker({ value, onChange, onSkip }: { value: string[]; onChange: (v: string[]) => void; onSkip?: () => void }) {
  const [search, setSearch] = React.useState(false);
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <View style={{ paddingTop: 8 }}>
      <StepHeader title="Where do you shop?" subtitle="We’ll tailor prices to your stores." />
      <View className="flex-row flex-wrap" style={{ gap: 10 }}>
        {GROCERY_STORES.map((store) => {
          const active = value.includes(store.id);
          return (
            <Pressable key={store.id} onPress={() => toggle(store.id)} accessibilityRole="button" accessibilityState={{ selected: active }} accessibilityLabel={store.label}
              className="rounded-2xl bg-card"
              style={[{ width: "31%", paddingVertical: 14, paddingHorizontal: 8, alignItems: "center", gap: 8 }, ELEVATION.low, active ? SELECTED_TILE : RESTING_TILE]}>
              {STORE_LOGOS[store.id] ? (
                <Image source={STORE_LOGOS[store.id]} resizeMode="contain" style={{ width: 40, height: 40 }} />
              ) : (
                <View style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: store.color, alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ color: "white", fontFamily: "Karla_700Bold", fontSize: 20 }}>{store.label.charAt(0)}</Text>
                </View>
              )}
              <Text className={`text-xs font-semibold text-center ${active ? "text-brand" : "text-ink"}`} numberOfLines={1}>{store.label}</Text>
            </Pressable>
          );
        })}
        {/* Actions share the store-tile shape, so the whole grid reads as one card family. */}
        <Pressable onPress={() => setSearch(true)} accessibilityRole="button" accessibilityLabel="Search for more stores" className="rounded-2xl bg-card" style={[{ width: "31%", paddingVertical: 14, paddingHorizontal: 8, alignItems: "center", gap: 8 }, ELEVATION.low, RESTING_TILE]}>
          <View style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center" }}><Icon name="search" size={26} color="#8A4A1E" /></View>
          <Text className="text-xs font-semibold text-center" style={{ color: "#8A4A1E" }} numberOfLines={1}>More</Text>
        </Pressable>
        {onSkip ? (
          <Pressable onPress={onSkip} accessibilityRole="button" accessibilityLabel="I shop elsewhere" className="rounded-2xl bg-card" style={[{ width: "31%", paddingVertical: 14, paddingHorizontal: 8, alignItems: "center", gap: 8 }, ELEVATION.low, RESTING_TILE]}>
            <View style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center" }}><Icon name="ellipsis-horizontal" size={26} color="#8A4A1E" /></View>
            <Text className="text-xs font-semibold text-center" style={{ color: "#8A4A1E" }} numberOfLines={1}>Elsewhere</Text>
          </Pressable>
        ) : null}
      </View>
      <SearchAddSheet visible={search} title="Add a store" corpus={ALL_GROCERY_STORES.map((store) => store.label)} selected={value.map((id) => STORE_ID_TO_LABEL[id]).filter(Boolean)} onToggle={(label) => toggle(STORE_LABEL_TO_ID[label])} onClose={() => setSearch(false)} />
    </View>
  );
}

/* ── 5. Slider step — big numeral hero + slider (budget, time) ──────────────────── */

export function OnboardingSliderStep({ title, subtitle, value, min, max, step, format, caption, onChange }: {
  title: string; subtitle?: string; value: number; min: number; max: number; step: number;
  format: (v: number) => string; caption?: string; onChange: (v: number) => void;
}) {
  const atMax = value >= max;
  return (
    <View style={{ paddingTop: 8 }}>
      <StepHeader title={title} subtitle={subtitle} />
      <View className="items-center" style={{ paddingVertical: 28, gap: 4 }}>
        <Text className="text-ink" style={{ fontFamily: "Karla_700Bold", fontSize: 56, lineHeight: 60 }}>{format(value)}{atMax ? "+" : ""}</Text>
        {caption ? <Text className="text-lg text-muted" style={{ fontFamily: "Karla_600SemiBold" }}>{caption}</Text> : null}
      </View>
      <Slider value={value} min={min} max={max} step={step} hideValue format={format} onChange={onChange} />
      <HStack className="justify-between" style={{ marginTop: 4 }}>
        <Text className="text-xs text-muted">{format(min)}</Text>
        <Text className="text-xs text-muted">{format(max)}+</Text>
      </HStack>
    </View>
  );
}

/* ── 6. Household counter — adults + kids ──────────────────────────────────────── */

export type Household = { adults: number; kids: number };

export function OnboardingCounter({ value, onChange }: { value: Household; onChange: (v: Household) => void }) {
  return (
    <View style={{ paddingTop: 8 }}>
      <StepHeader title="How many are you cooking for?" subtitle="We’ll size every portion right." />
      <Card>
        <HStack className="items-center justify-between">
          <VStack space={2}><Text className="text-base font-bold text-ink">Adults</Text><Text className="text-xs text-muted">13 and older</Text></VStack>
          <Stepper big value={value.adults} min={1} max={12} label="adults" onChange={(v) => onChange({ ...value, adults: v })} />
        </HStack>
        <HStack className="items-center justify-between">
          <VStack space={2}><Text className="text-base font-bold text-ink">Kids</Text><Text className="text-xs text-muted">12 and under</Text></VStack>
          <Stepper big value={value.kids} min={0} max={12} label="kids" onChange={(v) => onChange({ ...value, kids: v })} />
        </HStack>
      </Card>
    </View>
  );
}

/* ── 7. Day picker — weekday chips + live count ────────────────────────────────── */

const WEEKDAYS = [
  { v: "mon", l: "Mon" }, { v: "tue", l: "Tue" }, { v: "wed", l: "Wed" }, { v: "thu", l: "Thu" },
  { v: "fri", l: "Fri" }, { v: "sat", l: "Sat" }, { v: "sun", l: "Sun" },
];

export function OnboardingDayPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const toggle = (d: string) => onChange(value.includes(d) ? value.filter((x) => x !== d) : [...value, d]);
  const n = value.length;
  return (
    <View style={{ paddingTop: 8 }}>
      <StepHeader title="Which days do you cook?" subtitle="We’ll only plan for these days." />
      <View className="flex-row flex-wrap" style={{ gap: 8 }}>
        {WEEKDAYS.map((d) => <Chip key={d.v} label={d.l} active={value.includes(d.v)} onToggle={() => toggle(d.v)} />)}
      </View>
      <Text className={`text-sm ${n === 0 ? "text-error" : "text-muted"}`} style={{ marginTop: 16 }}>
        {n === 0 ? "Pick at least one day" : `${n} ${n === 1 ? "day" : "days"} a week`}
      </Text>
    </View>
  );
}

/* ── 8. Binary — two lifted option cards (leftovers) ───────────────────────────── */

export function OnboardingBinary({ title, subtitle, value, onChange, yes = { label: "Yes" }, no = { label: "No" } }: {
  title: string; subtitle?: string; value: boolean | null; onChange: (v: boolean) => void;
  yes?: { label: string; caption?: string }; no?: { label: string; caption?: string };
}) {
  const Option = ({ on, opt, sel }: { on: boolean; opt: { label: string; caption?: string }; sel: boolean }) => (
    <Pressable onPress={() => onChange(on)} accessibilityRole="button" accessibilityState={{ selected: sel }} accessibilityLabel={opt.label}
      className="rounded-2xl bg-card" style={[{ padding: 18, gap: 4 }, ELEVATION.low, sel ? SELECTED_TILE : RESTING_TILE]}>
      <Text className={`text-base font-bold ${sel ? "text-brand" : "text-ink"}`}>{opt.label}</Text>
      {opt.caption ? <Text className="text-sm text-muted">{opt.caption}</Text> : null}
    </Pressable>
  );
  return (
    <View style={{ paddingTop: 8 }}>
      <StepHeader title={title} subtitle={subtitle} />
      <VStack space={12}>
        <Option on opt={yes} sel={value === true} />
        <Option on={false} opt={no} sel={value === false} />
      </VStack>
    </View>
  );
}

/* ── 9. Severity picker — allergens / diets with a per-item level ──────────────── */

export type LeveledPref = { name: string; level: string };

export function OnboardingSeverityPicker({ title, subtitle, corpus, levels, defaultLevel, value, onChange, confirm }: {
  title: string; subtitle?: string; corpus: string[]; levels: { label: string; value: string }[]; defaultLevel: string;
  value: LeveledPref[]; onChange: (v: LeveledPref[]) => void; confirm?: (p: LeveledPref) => string;
}) {
  const add = (name: string) => onChange([...value, { name, level: defaultLevel }]);
  const remove = (name: string) => onChange(value.filter((x) => x.name !== name));
  const setLevel = (name: string, level: string) => onChange(value.map((x) => x.name === name ? { ...x, level } : x));
  const available = corpus.filter((c) => !value.some((x) => x.name === c));
  return (
    <View style={{ paddingTop: 8 }}>
      <StepHeader title={title} subtitle={subtitle} />
      <VStack space={12}>
        {value.map((pref) => (
          <Card key={pref.name}>
            <HStack className="items-center justify-between">
              <Text className="text-base capitalize text-ink">{pref.name}</Text>
              <Pressable onPress={() => remove(pref.name)} accessibilityLabel={`Remove ${pref.name}`}><Icon name="trash-outline" size={18} color="#6E5B48" /></Pressable>
            </HStack>
            <Segmented label={`${pref.name} level`} value={pref.level} onChange={(l) => setLevel(pref.name, l)} options={levels} />
            {confirm ? <Text className="text-xs text-muted">{confirm(pref)}</Text> : null}
          </Card>
        ))}
      </VStack>
      {available.length ? (
        <View className="flex-row flex-wrap justify-center" style={{ gap: 8, marginTop: value.length ? 24 : 4 }}>
          {available.map((c) => <Chip key={c} label={`+ ${c}`} active={false} onToggle={() => add(c)} />)}
        </View>
      ) : null}
    </View>
  );
}

/* ── 10. Taste menu — chips + search (cuisines / disliked ingredients) ─────────── */

export function OnboardingTasteMenu({ title, subtitle, presets, corpus, searchTitle, value, onChange }: {
  title: string; subtitle?: string; presets: string[]; corpus: string[]; searchTitle: string; value: string[]; onChange: (v: string[]) => void;
}) {
  const [search, setSearch] = React.useState(false);
  const toggle = (item: string) => onChange(value.includes(item) ? value.filter((x) => x !== item) : [...value, item]);
  const chips = Array.from(new Set([...presets, ...value]));
  return (
    <View style={{ paddingTop: 8 }}>
      <StepHeader title={title} subtitle={subtitle} />
      <View className="flex-row flex-wrap justify-center" style={{ gap: 8 }}>
        {chips.map((c) => <Chip key={c} label={c} active={value.includes(c)} onToggle={() => toggle(c)} />)}
        <MoreChip onPress={() => setSearch(true)} />
      </View>
      <SearchAddSheet visible={search} title={searchTitle} corpus={corpus} selected={value} onToggle={toggle} onClose={() => setSearch(false)} />
    </View>
  );
}

/* ── 11. Single-select list — rows with contextual microcopy (confidence) ──────── */

export function OnboardingSingleSelectList({ title, subtitle, options, value, onSelect }: {
  title: string; subtitle?: string; options: { value: string; label: string; icon?: IoniconName; microcopy?: string }[];
  value: string | null; onSelect: (v: string) => void;
}) {
  return (
    <View style={{ paddingTop: 8 }}>
      <StepHeader title={title} subtitle={subtitle} />
      <VStack space={10}>
        {options.map((o) => {
          const sel = o.value === value;
          return (
            <Pressable key={o.value} onPress={() => onSelect(o.value)} accessibilityRole="radio" accessibilityState={{ selected: sel }} accessibilityLabel={o.label}
              className="rounded-2xl bg-card" style={[{ padding: 16, gap: 6 }, ELEVATION.low, sel ? SELECTED_TILE : RESTING_TILE]}>
              <HStack className="items-center" space={12}>
                {o.icon ? <Icon name={o.icon} size={20} color={sel ? "#A85E2B" : "#6E5B48"} /> : null}
                <Text className={`text-base font-bold ${sel ? "text-brand" : "text-ink"}`}>{o.label}</Text>
              </HStack>
              {sel && o.microcopy ? <Text className="text-sm text-muted">{o.microcopy}</Text> : null}
            </Pressable>
          );
        })}
      </VStack>
    </View>
  );
}
