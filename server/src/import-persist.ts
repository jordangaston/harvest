import type { Database } from "./db.js";
import { RecipeRepository } from "./repositories/recipe-repository.js";
import { ImportJobRepository } from "./repositories/import-job-repository.js";
import { toRecipeInput } from "./parse/mapping.js";
import type { ImportInput } from "./import-domain.js";
import type { ExtractedRecipeData } from "./parse/extractor.js";

/**
 * Persist one or more extracted recipes for their owner and drive the job to
 * `ready`, linking every recipe in order. Ports the DBOS `persist` + `ready`
 * steps. The WHOLE persist — every recipe (with its ingredients and steps), the
 * job→recipe links, and the terminal status — runs in ONE interactive
 * transaction, so a mid-write failure rolls the entire import back with no
 * partial state. A carousel yields several recipes (one per slide); a single
 * source, one.
 *
 * Replay-safe: recipe ids are application-generated, `linkRecipes` is
 * `onConflictDoNothing`, and the status write is idempotent — so a workflow
 * re-run re-persists the same recipes rather than duplicates.
 *
 * @returns Every persisted recipe id, in slide order (the first is the job's
 *   headline recipe).
 */
export async function persistAndReady(
  db: Database,
  recipes: ExtractedRecipeData[],
  input: ImportInput,
): Promise<string[]> {
  const recipeRepo = RecipeRepository.create(db);
  const jobs = ImportJobRepository.create(db);
  return db.transaction(async (tx) => {
    const recipeIds: string[] = [];
    for (const data of recipes) {
      recipeIds.push(await recipeRepo.persist(toRecipeInput(data, input), input.userId, tx));
    }
    await jobs.linkRecipes(input.jobId, recipeIds, tx);
    await jobs.setTerminal(input.jobId, { status: "ready", progress: 100, recipeId: recipeIds[0] }, tx);
    return recipeIds;
  });
}
