import { type Equipment, type Essentiality } from '../schema.js';

/** One detected appliance for a recipe: the canonical type + its per-recipe essentiality
 * (the LLM's judgment; the config `defaultEssentiality` prior on fallback). */
export interface DetectedItem {
  equipment: Equipment;
  essentiality: Essentiality;
}

/** A recipe's equipment signal (WI-EQ-2): the rolled-up set the filter reads, the per-step
 * alignment for the "which step needs it" UI, and whether detection ran to completion.
 * `complete = false` after the deterministic fallback (or a withheld recipe) keeps the
 * filter lenient. */
export interface DetectedEquipment {
  equipment: DetectedItem[];
  stepEquipment: Equipment[][];
  complete: boolean;
}

/**
 * EQUIPMENT (WI-EQ-1) — the notable-appliance config: each canonical `Equipment` value with
 * its per-type essentiality PRIOR (the fallback the LLM overrides per recipe) and the surface
 * forms the deterministic matcher scans for. A code constant, not a table — small and versioned
 * with the code, matching the `TECHNIQUE_DIFFICULTY` / diet-rules precedent. Adding an appliance
 * is one entry here plus one value in `EQUIPMENT_TYPES` (schema.ts), no migration.
 *
 * `defaultEssentiality` is a calibration knob (EQUIPMENT-SIGNAL.md § Detection): sous-vide,
 * smoker, ice-cream maker and waffle iron are `required` (the dish IS the appliance); the rest
 * default `recommended` (a workable substitute usually exists). Whether a given recipe truly
 * requires the gear is the LLM's per-recipe judgment; this prior is used only on LLM failure.
 */
export interface EquipmentType {
  canonical: Equipment;
  defaultEssentiality: Essentiality;
  aliases: string[];
}

export const EQUIPMENT: EquipmentType[] = [
  // Baseline gear the onboarding offers as reassurance defaults — always `recommended`, so it never
  // becomes a required-equipment filter (the ranker only filters on `required` gear the user lacks).
  { canonical: 'oven', defaultEssentiality: 'recommended', aliases: ['oven'] },
  { canonical: 'stovetop', defaultEssentiality: 'recommended', aliases: ['stovetop', 'stove', 'hob'] },
  { canonical: 'microwave', defaultEssentiality: 'recommended', aliases: ['microwave'] },
  { canonical: 'air_fryer', defaultEssentiality: 'recommended', aliases: ['air fryer', 'air-fryer', 'airfryer'] },
  { canonical: 'slow_cooker', defaultEssentiality: 'recommended', aliases: ['slow cooker', 'crock pot', 'crockpot'] },
  { canonical: 'pressure_cooker', defaultEssentiality: 'recommended', aliases: ['pressure cooker', 'instant pot', 'instapot'] },
  { canonical: 'stand_mixer', defaultEssentiality: 'recommended', aliases: ['stand mixer', 'kitchenaid'] },
  { canonical: 'blender', defaultEssentiality: 'recommended', aliases: ['blender'] },
  { canonical: 'food_processor', defaultEssentiality: 'recommended', aliases: ['food processor'] },
  { canonical: 'grill', defaultEssentiality: 'recommended', aliases: ['grill', 'barbecue', 'bbq'] },
  { canonical: 'dutch_oven', defaultEssentiality: 'recommended', aliases: ['dutch oven'] },
  { canonical: 'deep_fryer', defaultEssentiality: 'recommended', aliases: ['deep fryer', 'deep-fry'] },
  { canonical: 'wok', defaultEssentiality: 'recommended', aliases: ['wok'] },
  { canonical: 'sous_vide', defaultEssentiality: 'required', aliases: ['sous vide', 'sous-vide', 'immersion circulator'] },
  { canonical: 'smoker', defaultEssentiality: 'required', aliases: ['smoker'] },
  { canonical: 'ice_cream_maker', defaultEssentiality: 'required', aliases: ['ice cream maker', 'ice-cream maker'] },
  { canonical: 'waffle_iron', defaultEssentiality: 'required', aliases: ['waffle iron', 'waffle maker'] },
];

/** The canonical equipment names — the LLM's allowed vocabulary and the validation set for
 * constraining its detections, like `TECHNIQUE_NAMES` / `VOCAB`. */
export const EQUIPMENT_NAMES: Equipment[] = EQUIPMENT.map((e) => e.canonical);

const CONFIG_BY_NAME = new Map<Equipment, EquipmentType>(EQUIPMENT.map((e) => [e.canonical, e]));

/** The essentiality prior for a canonical equipment value (the fallback the LLM overrides). */
export function defaultEssentiality(equipment: Equipment): Essentiality {
  return CONFIG_BY_NAME.get(equipment)!.defaultEssentiality;
}
