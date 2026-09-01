import type { PublicRecipe } from './models/recipe.js';

/**
 * Server-renders a public recipe as a standalone golden-hour HTML page — the target of the
 * iMessage recipe app card (docs/spikes/photon-app-recipe-card.md, Tier A). Self-contained
 * (one Google-Fonts link, everything else inline), mobile-first, and escapes all recipe-derived
 * text since titles/ingredients/steps come from user-imported content.
 * @param recipe - the public recipe to render (title, image, ingredients, steps, meta).
 * @param origin - the page's own absolute origin (for Open Graph `og:url`); optional.
 */
export function renderRecipePage(recipe: PublicRecipe, origin?: string): string {
  const meta = [
    recipe.servings ? `${recipe.servings} serving${recipe.servings === 1 ? '' : 's'}` : null,
    recipe.total_minutes ? `${recipe.total_minutes} min` : null,
  ].filter(Boolean);

  const ingredients = recipe.ingredients
    .map((ing) => {
      const qty = ing.quantity_text ?? [ing.amount, ing.unit].filter(Boolean).join(' ');
      return `<li>${qty ? `<span class="qty">${esc(qty)}</span> ` : ''}${esc(ing.name)}</li>`;
    })
    .join('');

  const steps = recipe.steps.map((s) => `<li>${esc(s)}</li>`).join('');
  const ogImage = recipe.image_url ? `<meta property="og:image" content="${esc(recipe.image_url)}" />` : '';
  const ogUrl = origin ? `<meta property="og:url" content="${esc(`${origin}/r/${recipe.id}`)}" />` : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(recipe.title)} · Harvest</title>
<meta property="og:type" content="article" />
<meta property="og:title" content="${esc(recipe.title)}" />
<meta property="og:description" content="A recipe saved with Harvest" />
${ogImage}
${ogUrl}
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link href="https://fonts.googleapis.com/css2?family=Karla:wght@400;600;700&family=Lora:wght@600;700&display=swap" rel="stylesheet" />
<style>
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
</style>
</head>
<body>
  <div class="wrap">
    <div class="brandbar">Harvest</div>
    ${
      recipe.image_url
        ? `<div class="hero"><div class="bg" style="background-image:url('${esc(recipe.image_url)}')"></div><img src="${esc(recipe.image_url)}" alt="${esc(recipe.title)}" /></div>`
        : `<div class="hero empty">🍽️</div>`
    }
    <div class="body">
      <h1>${esc(recipe.title)}</h1>
      ${meta.length ? `<div class="meta">${meta.map((m) => `<span>${esc(m!)}</span>`).join('')}</div>` : ''}
      <section>
        <h2>Ingredients</h2>
        <ul class="ingredients">${ingredients}</ul>
      </section>
      <section>
        <h2>Instructions</h2>
        <ol class="steps">${steps}</ol>
      </section>
      ${recipe.source_url ? `<a class="source" href="${esc(recipe.source_url)}">View original ↗</a>` : ''}
      <div class="foot">Saved with Harvest</div>
    </div>
  </div>
</body>
</html>`;
}

/** Escapes the five HTML-significant characters — recipe text is user-imported, so every
 *  interpolation into markup or an attribute goes through this. */
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
