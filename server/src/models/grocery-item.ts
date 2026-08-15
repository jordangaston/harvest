import { z } from 'zod';
import { groceryAisleEnum } from '../db/schema/enums.js';

/** pg `numeric` comes back as a string (or null); coerce to a number|null. */
const numericNullable = z
  .union([z.number(), z.string(), z.null()])
  .transform((v) => (v == null ? null : Number(v)));

/**
 * Domain model for a grocery item row. Repositories parse rows into this at the
 * boundary (matching the other models). `amount` is `numeric` in Postgres, so it
 * arrives as a string and is coerced here.
 */
export const GroceryItemSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  name: z.string(),
  amount: numericNullable,
  unit: z.string().nullable(),
  quantityText: z.string().nullable(),
  aisle: z.enum(groceryAisleEnum.enumValues),
  icon: z.string(),
  checked: z.boolean(),
  sourceRecipeId: z.string().uuid().nullable(),
  position: z.number().int(),
  createdAt: z.date(),
  // Present only on the list read (left-joined recipe title); undefined elsewhere.
  sourceRecipeTitle: z.string().nullable().optional(),
});

export type GroceryItem = z.infer<typeof GroceryItemSchema>;

/** The public grocery-item shape: snake_case wire fields, nulls kept explicit. */
export interface PublicGroceryItem {
  id: string;
  name: string;
  amount: number | null;
  unit: string | null;
  quantity_text: string | null;
  aisle: string;
  icon: string;
  checked: boolean;
  source_recipe_id: string | null;
  source_recipe_title: string | null;
  position: number;
}

/** Maps a domain grocery item to its public wire shape. */
export function toPublicGroceryItem(item: GroceryItem): PublicGroceryItem {
  return {
    id: item.id,
    name: item.name,
    amount: item.amount,
    unit: item.unit,
    quantity_text: item.quantityText,
    aisle: item.aisle,
    icon: item.icon,
    checked: item.checked,
    source_recipe_id: item.sourceRecipeId,
    source_recipe_title: item.sourceRecipeTitle ?? null,
    position: item.position,
  };
}
