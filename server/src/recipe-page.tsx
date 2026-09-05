import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PublicRecipe } from './models/recipe.js';
import { RECIPE_CSS_HREF } from './recipe-page.styles.js';

/**
 * Server-renders a public recipe as a golden-hour HTML page — the target of the iMessage recipe
 * app card (docs/spikes/photon-app-recipe-card.md, Tier A). Styled with Tailwind CSS v4 + daisyUI
 * (the custom `harvest` theme in styles/recipe.css); the built CSS ships as a content-hashed static
 * asset (`RECIPE_CSS_HREF`) so Vercel's CDN + the browser cache it across recipe pages. React
 * escapes all recipe-derived text, so user-imported titles/ingredients/steps are safe by default.
 * @param recipe - the public recipe to render (title, image, ingredients, steps, meta).
 * @param origin - the page's own absolute origin (for Open Graph `og:url`); optional.
 */
export function renderRecipePage(recipe: PublicRecipe, origin?: string, backHref?: string): string {
  return '<!doctype html>' + renderToStaticMarkup(<RecipePage recipe={recipe} origin={origin} backHref={backHref} />);
}

function RecipePage({ recipe, origin, backHref }: { recipe: PublicRecipe; origin?: string; backHref?: string }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{`${recipe.title} · Harvest`}</title>
        <meta property="og:type" content="article" />
        <meta property="og:title" content={recipe.title} />
        <meta property="og:description" content="A recipe saved with Harvest" />
        {recipe.image_url ? <meta property="og:image" content={recipe.image_url} /> : null}
        {origin ? <meta property="og:url" content={`${origin}/r/${recipe.id}`} /> : null}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Karla:wght@400;600;700&family=Lora:wght@600;700&display=swap"
          rel="stylesheet"
        />
        <link rel="stylesheet" href={RECIPE_CSS_HREF} />
      </head>
      <body className="min-h-screen bg-base-200 text-base-content">
        <main className="mx-auto max-w-2xl pb-12">
          <div className="flex items-center justify-between px-6 py-4">
            <div className="font-serif text-xl font-bold text-primary">Harvest</div>
            {backHref ? (
              <a href={backHref} className="link link-primary font-semibold no-underline">
                ← Your week
              </a>
            ) : null}
          </div>
          <div className="card overflow-hidden rounded-none bg-base-100 shadow-md sm:rounded-box">
            <figure>
              <Hero recipe={recipe} />
            </figure>
            <div className="card-body gap-6">
              <div>
                <h1 className="card-title font-serif text-3xl leading-tight">{recipe.title}</h1>
                <Meta recipe={recipe} />
              </div>

              <Section title="Ingredients">
                <ul className="list">
                  {recipe.ingredients.map((ing, i) => (
                    <li key={i} className="list-row py-3 text-base">
                      <span className="list-col-grow">
                        {qtyOf(ing) ? <span className="font-semibold text-primary">{qtyOf(ing)} </span> : null}
                        {ing.name}
                      </span>
                    </li>
                  ))}
                </ul>
              </Section>

              <Section title="Instructions">
                <ol className="flex flex-col gap-4">
                  {recipe.steps.map((step, i) => (
                    <li key={i} className="flex gap-3">
                      <span className="badge badge-lg badge-primary shrink-0 font-bold">{i + 1}</span>
                      <span className="pt-1 text-base leading-relaxed">{step}</span>
                    </li>
                  ))}
                </ol>
              </Section>

              {recipe.source_url ? (
                <a className="link link-primary font-semibold" href={recipe.source_url}>
                  View original ↗
                </a>
              ) : null}
            </div>
          </div>
          <div className="mt-8 text-center text-sm text-neutral">Saved with Harvest</div>
        </main>
      </body>
    </html>
  );
}

/** The blur-fill hero — a blurred cover backdrop with a contained image on top, so no aspect ratio
 *  is cropped (mirrors the mobile recipe screen). A 🍽️ placeholder when there is no image. Built
 *  with Tailwind utilities only (no authored CSS / inline visual styles). */
function Hero({ recipe }: { recipe: PublicRecipe }) {
  if (!recipe.image_url) {
    return <div className="flex aspect-[4/3] w-full items-center justify-center bg-primary/15 text-6xl">🍽️</div>;
  }
  return (
    <div className="relative aspect-[4/3] w-full overflow-hidden bg-primary/15">
      <img src={recipe.image_url} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full scale-110 object-cover blur-[28px]" />
      <img src={recipe.image_url} alt={recipe.title} className="absolute inset-0 h-full w-full object-contain" />
    </div>
  );
}

/** Servings · total time, each shown only when present. */
function Meta({ recipe }: { recipe: PublicRecipe }) {
  const items = [
    recipe.servings ? `${recipe.servings} serving${recipe.servings === 1 ? '' : 's'}` : null,
    recipe.total_minutes ? `${recipe.total_minutes} min` : null,
  ].filter(Boolean);
  if (items.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {items.map((m, i) => (
        <span key={i} className="badge badge-ghost">
          {m}
        </span>
      ))}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-base-content">{title}</h2>
      {children}
    </section>
  );
}

/** The ingredient's display quantity — the parsed `quantity_text`, else `amount unit`, else ''. */
function qtyOf(ing: PublicRecipe['ingredients'][number]): string {
  return ing.quantity_text ?? [ing.amount, ing.unit].filter(Boolean).join(' ');
}
