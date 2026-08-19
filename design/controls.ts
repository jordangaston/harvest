import type { ControlSpec, ControlValues } from "./types.ts";

/** Initial values for a control panel: each spec's key mapped to its default. */
export function seedValues(specs?: ControlSpec[]): ControlValues {
  const values: ControlValues = {};
  for (const spec of specs ?? []) values[spec.key] = spec.default;
  return values;
}

/** Immutably set one control's value, returning a new record. */
export function setValue(
  values: ControlValues,
  key: string,
  value: ControlValues[string],
): ControlValues {
  return { ...values, [key]: value };
}
