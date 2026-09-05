import { renderToStaticMarkup } from 'react-dom/server';
import type { MealPlanEntryView, MealSlot } from './models/meal-plan.js';
import { RECIPE_CSS_HREF } from './recipe-page.styles.js';

/** Meal sections in presentation order — dinners lead, lunches follow (the household approves
 *  dinners first); breakfast/snack appear only when planned. */
const MEAL_ORDER: MealSlot[] = ['dinner', 'lunch', 'breakfast', 'snack'];
const MEAL_LABEL: Record<MealSlot, string> = { dinner: 'Dinners', lunch: 'Lunches', breakfast: 'Breakfasts', snack: 'Snacks' };

/**
 * Server-renders a household's upcoming week as a golden-hour HTML page — the target of the single
 * iMessage plan app card. Same pipeline as the recipe page (Tailwind v4 + daisyUI `harvest` theme,
 * content-hashed CSS): meal-major sections (all dinners, then all lunches), one day card per slot,
 * each recipe a link into its own `/r/:id` page — the browser's back button is the way out.
 * @param entries - the window's plan entries (main first per slot by `position`).
 * @param origin - the page's own absolute origin (for links + Open Graph); optional.
 */
export function renderPlanPage(entries: MealPlanEntryView[], origin?: string): string {
  return '<!doctype html>' + renderToStaticMarkup(<PlanPage entries={entries} origin={origin} />);
}

function PlanPage({ entries, origin }: { entries: MealPlanEntryView[]; origin?: string }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Your week · Harvest</title>
        <meta property="og:type" content="website" />
        <meta property="og:title" content="Your week of meals" />
        <meta property="og:description" content="Planned with Harvest" />
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
          {entries.length === 0 ? (
            <div className="card mx-4 bg-base-100 p-8 text-center shadow-md sm:rounded-box">No meals planned yet.</div>
          ) : (
            MEAL_ORDER.filter((m) => entries.some((e) => e.meal === m)).map((meal) => (
              <MealSection key={meal} meal={meal} entries={entries.filter((e) => e.meal === meal)} origin={origin} />
            ))
          )}
          <div className="mt-8 text-center text-sm text-neutral">Planned with Harvest</div>
        </main>
      </body>
    </html>
  );
}

/** One meal's section: a day card per planned date, main first, sides beneath it. */
function MealSection({ meal, entries, origin }: { meal: MealSlot; entries: MealPlanEntryView[]; origin?: string }) {
  const dates = [...new Set(entries.map((e) => e.date))].sort();
  return (
    <section className="mt-6 px-4">
      <h2 className="mb-3 px-2 font-serif text-2xl font-bold">{MEAL_LABEL[meal]}</h2>
      <div className="flex flex-col gap-3">
        {dates.map((date) => (
          <div key={date} className="card bg-base-100 shadow-md sm:rounded-box">
            <div className="card-body gap-2 p-4">
              <div className="text-sm font-bold uppercase tracking-wide text-neutral">{dayLabel(date)}</div>
              {entries
                .filter((e) => e.date === date)
                .sort((a, b) => a.position - b.position)
                .map((e, i) => (
                  <RecipeRow key={e.id} entry={e} side={i > 0} origin={origin} />
                ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/** One tappable recipe row — thumbnail, title, a "with" prefix on sides. Links into `/r/:id`. */
function RecipeRow({ entry, side, origin }: { entry: MealPlanEntryView; side: boolean; origin?: string }) {
  return (
    <a href={`${origin ?? ''}/r/${entry.recipe.id}`} className="flex items-center gap-3 rounded-box p-1 no-underline">
      {entry.recipe.image_url ? (
        <img src={entry.recipe.image_url} alt="" className="h-12 w-12 shrink-0 rounded-box object-cover" />
      ) : (
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-box bg-primary/15 text-xl">🍽️</div>
      )}
      <span className={side ? 'text-sm text-neutral' : 'font-semibold'}>
        {side ? 'with ' : ''}
        {entry.recipe.title}
      </span>
    </a>
  );
}

/** "Monday · Sep 8" from a YYYY-MM-DD date. */
function dayLabel(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  const weekday = d.toLocaleDateString('en-US', { weekday: 'long' });
  const short = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${weekday} · ${short}`;
}
