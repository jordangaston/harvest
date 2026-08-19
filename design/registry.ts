import { RecipeCardStudy } from "./studies/RecipeCard.study";
import { findRegistryProblems } from "./integrity.ts";
import type { Study } from "./types.ts";

/** The canonical list of Design Studio components. Append one line per study. */
export const studies: Study[] = [RecipeCardStudy];

if (__DEV__) {
  const problems = findRegistryProblems(studies);
  if (problems.length) {
    throw new Error(`Design Studio registry is invalid:\n- ${problems.join("\n- ")}`);
  }
}
