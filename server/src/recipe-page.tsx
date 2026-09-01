import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PublicRecipe } from './models/recipe.js';

/**
 * Server-renders a public recipe as a standalone golden-hour HTML page — the target of the
 * iMessage recipe app card (docs/spikes/photon-app-recipe-card.md, Tier A). React components
 * (server-rendered to static markup) so the card can grow richer sections over time; React
 * escapes all recipe-derived text, so user-imported titles/ingredients/steps are safe by default.
 * @param recipe - the public recipe to render (title, image, ingredients, steps, meta).
 * @param origin - the page's own absolute origin (for Open Graph `og:url`); optional.
 */
export function renderRecipePage(recipe: PublicRecipe, origin?: string): string {
  return '<!doctype html>' + renderToStaticMarkup(<RecipePage recipe={recipe} origin={origin} />);
}

function RecipePage({ recipe, origin }: { recipe: PublicRecipe; origin?: string }) {
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
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
      </head>
      <body>
        <div className="wrap">
          <div className="brandbar">Harvest</div>
          <Hero recipe={recipe} />
          <div className="body">
            <h1>{recipe.title}</h1>
            <Meta recipe={recipe} />
            <Section title="Ingredients">
              <ul className="ingredients">
                {recipe.ingredients.map((ing, i) => (
                  <li key={i}>
                    {qtyOf(ing) ? <span className="qty">{qtyOf(ing)} </span> : null}
                    {ing.name}
                  </li>
                ))}
              </ul>
            </Section>
            <Section title="Instructions">
              <ol className="steps">
                {recipe.steps.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ol>
            </Section>
            {recipe.source_url ? (
              <a className="source" href={recipe.source_url}>
                View original ↗
              </a>
            ) : null}
            <div className="foot">Saved with Harvest</div>
          </div>
        </div>
      </body>
    </html>
  );
}

/** The blur-fill hero (a blurred cover backdrop + a contained image, so no aspect ratio is
 *  cropped), mirroring the mobile recipe screen; a 🍽️ placeholder when there's no image. */
function Hero({ recipe }: { recipe: PublicRecipe }) {
  if (!recipe.image_url) return <div className="hero empty">🍽️</div>;
  return (
    <div className="hero">
      <div className="bg" style={{ backgroundImage: `url('${recipe.image_url}')` }} />
      <img src={recipe.image_url} alt={recipe.title} />
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
    <div className="meta">
      {items.map((m, i) => (
        <span key={i}>{m}</span>
      ))}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

/** The ingredient's display quantity — the parsed `quantity_text`, else `amount unit`, else ''. */
function qtyOf(ing: PublicRecipe['ingredients'][number]): string {
  return ing.quantity_text ?? [ing.amount, ing.unit].filter(Boolean).join(' ');
}

const CSS = `
  :root {
    --cream: #F1E6D2; --card: #FBF6EC; --ink: #2E2419; --muted: #6E5B48;
    --brand: #A85E2B; --brand-light: #F3E0CC; --hairline: #E4D6BC;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--cream); color: var(--ink);
    font-family: Karla, system-ui, -apple-system, sans-serif; line-height: 1.5; }
  .wrap { max-width: 640px; margin: 0 auto; padding-bottom: 48px; }
  .brandbar { padding: 16px 24px; font-family: Lora, Georgia, serif; font-weight: 700;
    font-size: 20px; color: var(--brand); }
  .hero { position: relative; width: 100%; aspect-ratio: 4 / 3; background: var(--brand-light);
    overflow: hidden; }
  .hero .bg { position: absolute; inset: 0; background-size: cover; background-position: center;
    filter: blur(28px); transform: scale(1.15); }
  .hero img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
  .hero.empty { display: flex; align-items: center; justify-content: center; font-size: 56px; }
  .body { padding: 24px; }
  h1 { font-family: Lora, Georgia, serif; font-weight: 700; font-size: 30px; line-height: 1.2;
    color: var(--ink); }
  .meta { display: flex; gap: 8px; margin-top: 10px; color: var(--muted); font-size: 15px; }
  .meta span:not(:first-child)::before { content: "·"; margin-right: 8px; }
  section { margin-top: 28px; }
  h2 { font-size: 14px; font-weight: 700; letter-spacing: 0.08em; color: var(--ink);
    text-transform: uppercase; margin-bottom: 14px; }
  ul.ingredients { list-style: none; }
  ul.ingredients li { padding: 10px 0; border-bottom: 1px solid var(--hairline); font-size: 16px; }
  ul.ingredients li:last-child { border-bottom: none; }
  .qty { font-weight: 600; color: var(--brand); }
  ol.steps { list-style: none; counter-reset: step; }
  ol.steps li { counter-increment: step; position: relative; padding: 4px 0 18px 44px; font-size: 16px; }
  ol.steps li::before { content: counter(step); position: absolute; left: 0; top: 0;
    width: 28px; height: 28px; border-radius: 50%; background: var(--brand); color: #fff;
    font-weight: 700; font-size: 14px; display: flex; align-items: center; justify-content: center; }
  .source { display: inline-block; margin-top: 24px; color: var(--brand); font-weight: 600;
    text-decoration: none; font-size: 15px; }
  .foot { margin-top: 40px; text-align: center; color: var(--muted); font-size: 13px; }
`;
