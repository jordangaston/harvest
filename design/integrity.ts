/**
 * Pure registry validation, kept free of any React Native imports so it can run
 * under `node --test`. The real registry runs this at dev startup; the test
 * exercises the same logic against fixtures.
 */
export type RegistryEntry = { name: string; controls?: { key: string }[] };

/** Human-readable problems in a study registry; an empty array means it is valid. */
export function findRegistryProblems(entries: RegistryEntry[]): string[] {
  const problems: string[] = [];
  const seenNames = new Set<string>();

  for (const entry of entries) {
    if (!entry.name?.trim()) problems.push("a study has an empty name");
    else if (seenNames.has(entry.name)) problems.push(`duplicate study name: ${entry.name}`);
    else seenNames.add(entry.name);

    const seenKeys = new Set<string>();
    for (const control of entry.controls ?? []) {
      if (seenKeys.has(control.key)) {
        problems.push(`${entry.name}: duplicate control key: ${control.key}`);
      } else seenKeys.add(control.key);
    }
  }

  return problems;
}
