import { View } from "react-native";
import { VStack, HStack, Text, Pressable, Switch, Input } from "../components/ui";
import { setValue } from "./controls.ts";
import type { ControlSpec, ControlValues } from "./types.ts";

/**
 * Renders one labelled control per spec and reports edits back through onChange.
 * Controlled: the parent owns `values` (seeded from the study's defaults) and
 * re-seeds by remounting with a key of the study name.
 */
export function Controls({
  specs,
  values,
  onChange,
}: {
  specs: ControlSpec[];
  values: ControlValues;
  onChange: (next: ControlValues) => void;
}) {
  const set = (key: string, v: ControlValues[string]) => onChange(setValue(values, key, v));

  return (
    <VStack space={16} className="rounded-2xl border border-hairline bg-card p-4">
      {specs.map((spec) => (
        <VStack key={spec.key} space={6}>
          <Text className="text-xs font-bold uppercase tracking-wide text-muted">{spec.label}</Text>
          {spec.kind === "boolean" ? (
            <HStack className="items-center">
              <Switch value={Boolean(values[spec.key])} onValueChange={(v) => set(spec.key, v)} />
            </HStack>
          ) : spec.kind === "enum" ? (
            <HStack space={8} className="flex-wrap">
              {spec.options.map((opt) => {
                const selected = values[spec.key] === opt;
                return (
                  <Pressable
                    key={opt}
                    onPress={() => set(spec.key, opt)}
                    className={`rounded-full border px-3 py-1.5 ${
                      selected ? "border-brand bg-brand-light" : "border-hairline bg-card"
                    }`}
                  >
                    <Text className={`text-sm ${selected ? "font-bold text-brand" : "text-ink"}`}>{opt}</Text>
                  </Pressable>
                );
              })}
            </HStack>
          ) : spec.kind === "number" ? (
            <Input
              value={String(values[spec.key] ?? "")}
              keyboardType="numeric"
              onChangeText={(t) => set(spec.key, Number(t.replace(/[^0-9.-]/g, "")) || 0)}
            />
          ) : (
            <Input value={String(values[spec.key] ?? "")} onChangeText={(t) => set(spec.key, t)} />
          )}
        </VStack>
      ))}
      {specs.length === 0 ? <Text className="text-sm text-muted">No editable props.</Text> : null}
      <View />
    </VStack>
  );
}
