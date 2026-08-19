import type { ReactNode } from "react";

/** A single editable prop on a study, rendered as one control in the panel. */
export type ControlSpec =
  | { kind: "boolean"; key: string; label: string; default: boolean }
  | { kind: "enum"; key: string; label: string; options: string[]; default: string }
  | { kind: "text"; key: string; label: string; default: string }
  | { kind: "number"; key: string; label: string; default: number };

export type ControlValues = Record<string, boolean | string | number>;

/** A component showcased in the Design Studio, referenced everywhere by `name`. */
export type Study = {
  name: string;
  group?: string;
  controls?: ControlSpec[];
  render: (values: ControlValues) => ReactNode;
};
