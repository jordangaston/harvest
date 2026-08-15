import { ExtractedRecipeSchema, type ExtractedRecipe, type ImportInput } from './domain.js';

/**
 * OFFLINE stubs — the Workers-side stand-ins for the DBOS pipeline's network
 * steps (scrape → extract). They make no network call, exactly like the test
 * suite's stubs, so the proof is deterministic and hermetic. The real
 * providers (Apify/LamaTok scrape, Tesseract/Whisper/VLM, DeepSeek extract)
 * swap in behind these same two seams — see the RECOMMENDATION for which of
 * them are Workers-incompatible (ffmpeg, tesseract.js) and how they move.
 */

/** A fetched-material handoff (serializable — only URLs/text cross step boundaries). */
export interface Material {
  caption?: string;
  sourceUrl: string;
}

/** Stub scrape: resolves any source to a fixed caption (no network). */
export async function fetchSource(input: ImportInput): Promise<Material> {
  return { caption: `stub caption for ${input.sourceRef}`, sourceUrl: input.sourceRef };
}

/** Stub extract: returns one deterministic recipe (no network / no LLM). */
export async function extract(_material: Material): Promise<ExtractedRecipe> {
  return ExtractedRecipeSchema.parse({
    title: 'Creamy Garlic Chicken',
    servings: '4',
    totalMinutes: 30,
    confidence: 0.9,
    ingredients: [
      { name: 'chicken breasts', amount: '2', unit: null, quantityText: '2 chicken breasts' },
      { name: 'garlic', amount: '4', unit: 'cloves', quantityText: '4 cloves garlic' },
      { name: 'heavy cream', amount: '1', unit: 'cup', quantityText: '1 cup heavy cream' },
      { name: 'parmesan', amount: '0.5', unit: 'cup', quantityText: '½ cup grated parmesan' },
    ],
    steps: [
      'Season and sear the chicken until golden, then set aside.',
      'Soften the garlic, pour in the cream, and simmer.',
      'Stir in the parmesan, return the chicken, and coat in the sauce.',
    ],
  });
}
