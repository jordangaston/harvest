import React from "react";

/**
 * Best-effort human label for a Button tap. Reads string children directly, or the first
 * string-bearing descendant (e.g. `<ButtonText>Save</ButtonText>`). Returns undefined for
 * icon-only or otherwise opaque children so we never emit a `[object Object]` label.
 */
export function extractLabel(children: React.ReactNode): string | undefined {
  if (typeof children === "string") return children.trim() || undefined;
  if (typeof children === "number") return String(children);
  if (Array.isArray(children)) {
    for (const child of children) {
      const found = extractLabel(child);
      if (found) return found;
    }
    return undefined;
  }
  if (React.isValidElement(children)) {
    return extractLabel((children.props as { children?: React.ReactNode }).children);
  }
  return undefined;
}
