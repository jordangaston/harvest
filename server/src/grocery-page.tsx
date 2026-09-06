import { renderToStaticMarkup } from 'react-dom/server';
import type { GroceryItem } from './models/grocery-item.js';
import { RECIPE_CSS_HREF } from './recipe-page.styles.js';

/** Store-walk order — mirrors the mobile app's `lib/grocery/sort.ts` AISLE_ORDER (the `grocery_aisle` enum). */
const AISLE_ORDER = [
  'produce',
  'meat_seafood',
  'dairy_eggs_fridge',
  'bakery',
  'pantry',
  'herbs_spices',
  'frozen',
  'beverages',
  'household',
  'other',
] as const;

type Aisle = (typeof AISLE_ORDER)[number];

const AISLE_LABELS: Record<Aisle, string> = {
  produce: 'PRODUCE',
  meat_seafood: 'MEAT & SEAFOOD',
  dairy_eggs_fridge: 'DAIRY, EGGS & FRIDGE',
  bakery: 'BAKERY',
  pantry: 'PANTRY',
  herbs_spices: 'HERBS & SPICES',
  frozen: 'FROZEN',
  beverages: 'BEVERAGES',
  household: 'HOUSEHOLD',
  other: 'OTHER',
};

const FRACTIONS: Record<number, string> = { 0.25: '¼', 0.5: '½', 0.75: '¾' };

/** "1½", "¼", "2" — the quantity glyph, mirroring `lib/grocery/scale.ts` formatNumber. */
function formatNumber(n: number): string {
  const whole = Math.floor(n);
  const frac = Math.round((n - whole) * 100) / 100;
  const glyph = FRACTIONS[frac];
  if (glyph) return whole > 0 ? `${whole}${glyph}` : glyph;
  return String(Math.round(n * 100) / 100);
}

/** cup → cups when the amount isn't 1. */
function pluralizeUnit(unit: string, amount: number): string {
  if (amount === 1 || unit.endsWith('s')) return unit;
  return `${unit}s`;
}

/** The display quantity: a freeform `quantityText` wins, else amount + unit ("1½ cups", "12"). Mirrors
 *  the mobile app's `formatQuantity` so the card reads the same as the grocery tab. */
function formatQuantity(amount: number | null, unit: string | null, quantityText: string | null): string {
  if (quantityText) return quantityText;
  if (amount == null) return '';
  if (!unit || unit === 'count') return formatNumber(amount);
  return `${formatNumber(amount)} ${pluralizeUnit(unit, amount)}`;
}

/** Unchecked first, checked sunk; ties by list position — mirrors `sort.ts` sink(). */
function sink(items: GroceryItem[]): GroceryItem[] {
  return [...items].sort((a, b) => (a.checked === b.checked ? a.position - b.position : a.checked ? 1 : -1));
}

/**
 * Server-renders a household's grocery list as a golden-hour HTML page — the target of the single
 * iMessage grocery app card (`/g/:householdId`). Same pipeline as the plan page (Tailwind v4 +
 * daisyUI `harvest` theme, content-hashed CSS): aisle-major sections in store-walk order, checked
 * items de-emphasized and sunk within each aisle, quantities formatted like the grocery tab.
 * @param items - the household's whole list (any order; grouped + sorted here).
 * @param origin - the page's own absolute origin (Open Graph); optional.
 */
export function renderGroceryPage(items: GroceryItem[], origin?: string): string {
  return '<!doctype html>' + renderToStaticMarkup(<GroceryPage items={items} origin={origin} />);
}

function GroceryPage({ items, origin }: { items: GroceryItem[]; origin?: string }) {
  const sections = AISLE_ORDER.map((aisle) => ({
    aisle,
    items: sink(items.filter((i) => i.aisle === aisle)),
  })).filter((s) => s.items.length > 0);

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Your grocery list · Harvest</title>
        <meta property="og:type" content="website" />
        <meta property="og:title" content="Your grocery list" />
        <meta property="og:description" content="Planned with Harvest" />
        {origin ? <meta property="og:url" content={`${origin}`} /> : null}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Karla:wght@400;600;700&family=Lora:wght@600;700&display=swap"
          rel="stylesheet"
        />
        <link rel="stylesheet" href={RECIPE_CSS_HREF} />
      </head>
      <body className="min-h-screen bg-base-200 text-base-content">
        <main className="mx-auto max-w-2xl pb-12">
          <div className="px-6 py-4 font-serif text-xl font-bold text-primary">Harvest</div>
          {items.length === 0 ? (
            <div className="card mx-4 bg-base-100 p-8 text-center shadow-md sm:rounded-box">Your list is empty.</div>
          ) : (
            <>
              <div className="px-6 pb-2 text-sm text-neutral">{items.length} items</div>
              {sections.map((s) => (
                <AisleSection key={s.aisle} label={AISLE_LABELS[s.aisle]} items={s.items} />
              ))}
            </>
          )}
          <div className="mt-8 text-center text-sm text-neutral">Planned with Harvest</div>
        </main>
      </body>
    </html>
  );
}

/** One aisle's section: a card holding its rows, unchecked before checked. */
function AisleSection({ label, items }: { label: string; items: GroceryItem[] }) {
  return (
    <section className="mt-6 px-4">
      <h2 className="mb-3 px-2 font-serif text-2xl font-bold">{label}</h2>
      <div className="card bg-base-100 shadow-md sm:rounded-box">
        <div className="card-body gap-1 p-4">
          {items.map((item) => (
            <ItemRow key={item.id} item={item} />
          ))}
        </div>
      </div>
    </section>
  );
}

/** One grocery row — name + quantity; a checked item is struck through and dimmed (bought). */
function ItemRow({ item }: { item: GroceryItem }) {
  const qty = formatQuantity(item.amount, item.unit, item.quantityText);
  return (
    <div className={`flex items-baseline justify-between gap-3 py-1 ${item.checked ? 'text-neutral line-through opacity-60' : ''}`}>
      <span className="font-semibold">{item.name}</span>
      {qty ? <span className="shrink-0 text-sm text-neutral">{qty}</span> : null}
    </div>
  );
}
