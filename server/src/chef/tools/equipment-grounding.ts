import { EquipmentMatcher } from '../../equipment/equipment-matcher.js';
import type { Equipment } from '../../schema.js';

// The app's equipment gazetteer, compiled once. Reused here so the chef grounds "instant pot"→
// pressure_cooker through the same aliases recipes use — never a second, lower-fidelity alias map.
const MATCHER = EquipmentMatcher.create();

/** The canonical equipment named in a free-text phrase ("instant pot" → pressure_cooker; [] if none). */
export function resolveEquipment(text: string): Equipment[] {
  return MATCHER.detect([text]).equipment.map((e) => e.equipment);
}
