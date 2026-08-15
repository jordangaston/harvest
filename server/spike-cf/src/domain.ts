import { z } from 'zod';

/**
 * Portable domain models — the Zod layer moves to Workers unchanged (no Node
 * APIs). These mirror `server/src/parse/*` and `server/src/models/*` shapes,
 * trimmed to the import-path slice the proof exercises.
 */

export const SOURCE_TYPES = ['instagram', 'tiktok', 'facebook', 'pinterest', 'youtube', 'website', 'photo'] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

/** A parsed ingredient (C3: separated amount/unit + verbatim quantity text). */
export const StructuredIngredientSchema = z.object({
  name: z.string(),
  amount: z.string().nullable(),
  unit: z.string().nullable(),
  quantityText: z.string().nullable(),
});
export type StructuredIngredient = z.infer<typeof StructuredIngredientSchema>;

/** What the extractor yields — the LLM-free structured recipe. */
export const ExtractedRecipeSchema = z.object({
  title: z.string(),
  servings: z.string().optional(),
  totalMinutes: z.number().optional(),
  imageUrl: z.string().optional(),
  confidence: z.number(),
  ingredients: z.array(StructuredIngredientSchema),
  steps: z.array(z.string()),
});
export type ExtractedRecipe = z.infer<typeof ExtractedRecipeSchema>;

/** What the pipeline needs to import a job: the resolved source + its owner. */
export interface ImportInput {
  jobId: string;
  userId: string;
  sourceType: SourceType;
  sourceRef: string;
  /** Proof-only: inject a one-shot fault into a named step to exercise recovery. */
  faultStep?: 'extract';
}

/** Machine error codes a failed job records (matches server/src/db enums). */
export type ImportErrorCode = 'NO_RECIPE' | 'FETCH_FAILED' | 'EXTRACTION_FAILED' | 'MEDIA_UNAVAILABLE' | 'UNSUPPORTED';

/** A typed import failure carrying the code the job records. */
export class ImportError extends Error {
  constructor(readonly code: ImportErrorCode) {
    super(code);
    this.name = 'ImportError';
  }
  static codeOf(err: unknown): ImportErrorCode {
    return err instanceof ImportError ? err.code : 'EXTRACTION_FAILED';
  }
}
