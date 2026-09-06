import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import type { Database } from '../../db.js';
import { GroceryService } from '../../services/grocery-service.js';
import type { GroceryItem } from '../../models/grocery-item.js';
import type { ChefTool, TurnContext } from './types.js';

/** The public grocery-card URL for a household — the whole list as one tappable page (`/g/:householdId`),
 *  or undefined when `PUBLIC_APP_URL` is unset (model then skips the card). Mirrors `planUrl`. */
function groceryUrl(householdId: string): string | undefined {
  const base = process.env.PUBLIC_APP_URL?.replace(/\/$/, '');
  return base ? `${base}/g/${householdId}` : undefined;
}

/** One resolved list row the model can act on. */
interface ResolvedRow {
  spoken: string;
  item: GroceryItem;
}
/** A spoken name that matched several rows — the model must pick, never guess. */
interface Ambiguous {
  spoken: string;
  candidates: { id: string; name: string; unit: string | null; amount: number | null }[];
}

/** O-01 name resolution — a pure function over the household's current rows. For each spoken name it
 *  finds the acting row by exact, then case/plural-insensitive, then unique-substring match. A name
 *  matching several rows is `ambiguous` (candidates returned); a name matching none is `unmatched`.
 *  The caller acts only on `matched`, so a remove/check never fires on a guess. */
export function resolveNames(
  items: GroceryItem[],
  spokenNames: string[],
): { matched: ResolvedRow[]; unmatched: string[]; ambiguous: Ambiguous[] } {
  const matched: ResolvedRow[] = [];
  const unmatched: string[] = [];
  const ambiguous: Ambiguous[] = [];

  for (const spoken of spokenNames) {
    const hits = matchRows(items, spoken);
    if (hits.length === 1) matched.push({ spoken, item: hits[0]! });
    else if (hits.length === 0) unmatched.push(spoken);
    else ambiguous.push({ spoken, candidates: hits.map(toCandidate) });
  }
  return { matched, unmatched, ambiguous };
}

/** The rows a spoken name resolves to, at the strongest tier that matches: exact name, then
 *  normalized (case + trailing-s), then substring (either direction, on the normalized forms). */
function matchRows(items: GroceryItem[], spoken: string): GroceryItem[] {
  const q = normalize(spoken);
  const exact = items.filter((i) => i.name.trim().toLowerCase() === spoken.trim().toLowerCase());
  if (exact.length) return exact;
  const normal = items.filter((i) => normalize(i.name) === q);
  if (normal.length) return normal;
  return items.filter((i) => {
    const n = normalize(i.name);
    return n.includes(q) || q.includes(n);
  });
}

/** Lower-cases, trims, collapses whitespace, drops a leading article ("the milk" ~ "milk") and a
 *  trailing plural "s" ("Eggs" ~ "egg") so a spoken name lands on its row. */
function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ').replace(/^(the|a|an|some) /, '').replace(/s$/, '');
}

function toCandidate(item: GroceryItem): Ambiguous['candidates'][number] {
  return { id: item.id, name: item.name, unit: item.unit, amount: item.amount };
}

const publicItem = (i: GroceryItem) => ({
  id: i.id,
  name: i.name,
  amount: i.amount,
  unit: i.unit,
  quantity_text: i.quantityText,
  aisle: i.aisle,
  checked: i.checked,
});

/**
 * Reads the household's grocery list for Sage to present. Returns the item count, the browsable card
 * URL (`/g/:householdId`), and the items — read-only. An empty list returns count 0.
 */
export class ViewGroceryTool implements ChefTool {
  readonly id = 'grocery__view';
  private readonly groceries: GroceryService;

  private constructor(private readonly ctx: TurnContext, db: Database) {
    this.groceries = GroceryService.create(db);
  }

  static create(ctx: TurnContext, db: Database): ViewGroceryTool {
    return new ViewGroceryTool(ctx, db);
  }

  canRun(): boolean {
    return !!this.ctx.householdId;
  }

  asMastraTool() {
    return createTool({
      id: this.id,
      description:
        "Read the household's grocery list — for \"what do we need?\". Takes no input. Returns " +
        '{ count, list_url, items: [{ id, name, amount, unit, quantity_text, aisle, checked }] }. ' +
        'When count > 0, share `list_url` (one chat__send, type "richlink") — the whole list lands as a ' +
        'tappable card, aisle by aisle. When count is 0, say the list is empty in words (no card).',
      inputSchema: z.object({}),
      execute: async () => this.run(),
    });
  }

  async run(): Promise<{ count: number; list_url?: string; items: ReturnType<typeof publicItem>[] }> {
    const items = await this.groceries.list(this.ctx.householdId!);
    return { count: items.length, list_url: groceryUrl(this.ctx.householdId!), items: items.map(publicItem) };
  }
}

/**
 * Adds items to the household's list. Each is resolved to an aisle/icon/default-unit and merged into a
 * matching line (same name + unit) or inserted; the caller is recorded as `added_by_user_id`.
 */
export class AddGroceryTool implements ChefTool {
  readonly id = 'grocery__add';
  private readonly groceries: GroceryService;

  private constructor(private readonly ctx: TurnContext, db: Database) {
    this.groceries = GroceryService.create(db);
  }

  static create(ctx: TurnContext, db: Database): AddGroceryTool {
    return new AddGroceryTool(ctx, db);
  }

  canRun(): boolean {
    return !!this.ctx.householdId;
  }

  asMastraTool() {
    return createTool({
      id: this.id,
      description:
        'Add items to the household\'s grocery list — "add eggs and a dozen tortillas". Pass `items`, ' +
        'each { name, amount? (a number), unit? }; parse "2 cups of flour" into { name:"flour", amount:2, ' +
        'unit:"cup" } yourself. The server resolves each item\'s aisle/icon/default-unit and merges a ' +
        're-added item into its existing line. Returns { added: [{ name, amount, unit }] }.',
      inputSchema: z.object({
        items: z
          .array(
            z.object({
              name: z.string(),
              amount: z.number().nullable().optional(),
              unit: z.string().nullable().optional(),
            }),
          )
          .min(1),
      }),
      execute: async ({ items }) => this.run(items),
    });
  }

  async run(items: { name: string; amount?: number | null; unit?: string | null }[]): Promise<{ added: { name: string; amount: number | null; unit: string | null }[] }> {
    const added = await this.groceries.add(this.ctx.householdId!, items, this.ctx.initiatorUserId);
    return { added: added.map((i) => ({ name: i.name, amount: i.amount, unit: i.unit })) };
  }
}

/**
 * Removes named items from the household's list. Each spoken name is resolved to a row via O-01; a
 * name that matches nothing or several rows is returned in `unmatched`/`ambiguous` (with candidates)
 * and nothing is deleted for it — so the model asks which one instead of guessing.
 */
export class RemoveGroceryTool implements ChefTool {
  readonly id = 'grocery__remove';
  private readonly groceries: GroceryService;

  private constructor(private readonly ctx: TurnContext, db: Database) {
    this.groceries = GroceryService.create(db);
  }

  static create(ctx: TurnContext, db: Database): RemoveGroceryTool {
    return new RemoveGroceryTool(ctx, db);
  }

  canRun(): boolean {
    return !!this.ctx.householdId;
  }

  asMastraTool() {
    return createTool({
      id: this.id,
      description:
        'Remove items from the household\'s grocery list by name — "take milk off the list". Pass `names` ' +
        '(the spoken names). Returns { removed: [names], unmatched: [names], ambiguous: [{ name, candidates: ' +
        '[{ id, name, unit, amount }] }] }. If a name is unmatched or ambiguous, nothing was removed for it — ' +
        'ask the household which one; never guess.',
      inputSchema: z.object({ names: z.array(z.string()).min(1) }),
      execute: async ({ names }) => this.run(names),
    });
  }

  async run(names: string[]): Promise<{ removed: string[]; unmatched: string[]; ambiguous: Ambiguous[] }> {
    const items = await this.groceries.list(this.ctx.householdId!);
    const { matched, unmatched, ambiguous } = resolveNames(items, names);
    for (const { item } of matched) await this.groceries.remove(this.ctx.householdId!, item.id);
    return { removed: matched.map((m) => m.item.name), unmatched, ambiguous };
  }
}

/**
 * Checks off (or un-checks) named items on the household's list. Each spoken name is resolved via O-01;
 * unmatched/ambiguous names are returned untouched (with candidates) so the model asks, never guesses.
 */
export class CheckGroceryTool implements ChefTool {
  readonly id = 'grocery__check';
  private readonly groceries: GroceryService;

  private constructor(private readonly ctx: TurnContext, db: Database) {
    this.groceries = GroceryService.create(db);
  }

  static create(ctx: TurnContext, db: Database): CheckGroceryTool {
    return new CheckGroceryTool(ctx, db);
  }

  canRun(): boolean {
    return !!this.ctx.householdId;
  }

  asMastraTool() {
    return createTool({
      id: this.id,
      description:
        'Check off or un-check items on the household\'s list — "got the chicken" (checked), "we still ' +
        'need eggs" (un-checked). Pass `names` and `checked` (true to check off, false to un-check). Returns ' +
        '{ updated: [names], unmatched: [names], ambiguous: [{ name, candidates: [...] }] }. Unmatched or ' +
        'ambiguous names were not touched — ask which one; never guess.',
      inputSchema: z.object({ names: z.array(z.string()).min(1), checked: z.boolean().default(true) }),
      execute: async ({ names, checked }) => this.run(names, checked),
    });
  }

  async run(names: string[], checked: boolean): Promise<{ updated: string[]; unmatched: string[]; ambiguous: Ambiguous[] }> {
    const items = await this.groceries.list(this.ctx.householdId!);
    const { matched, unmatched, ambiguous } = resolveNames(items, names);
    for (const { item } of matched) await this.groceries.patch(this.ctx.householdId!, item.id, { checked });
    return { updated: matched.map((m) => m.item.name), unmatched, ambiguous };
  }
}
