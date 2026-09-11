import type { Client } from '@libsql/client';
import type { RecipeCard } from './draft.js';

/** Load `{title, ingredients}` for the given recipe ids — the display/prompt payload the Tier 2
 * draft script and review portal both need. One query for titles, one for ingredients. */
export async function loadRecipeCards(client: Client, ids: string[]): Promise<Map<string, RecipeCard>> {
  const cards = new Map<string, RecipeCard>();
  if (ids.length === 0) return cards;
  const inList = ids.map((id) => `'${id.replace(/'/g, "''")}'`).join(',');

  const titles = (await client.execute(`SELECT id, title FROM recipes WHERE id IN (${inList})`)).rows as unknown as { id: string; title: string }[];
  for (const r of titles) cards.set(r.id, { id: r.id, title: r.title, ingredients: [] });

  const ings = (await client.execute(`SELECT recipe_id, name FROM ingredients WHERE recipe_id IN (${inList}) ORDER BY position`)).rows as unknown as { recipe_id: string; name: string }[];
  for (const r of ings) cards.get(r.recipe_id)?.ingredients.push(r.name);
  return cards;
}
