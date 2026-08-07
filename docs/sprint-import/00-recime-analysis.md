# Recime Import Feature — Flow Analysis

Source: `~/Downloads/ScreenRecording_08-05-2026 21-51-14_1.MP4` (2:40, portrait phone
recording). Analyzed via 80 frames @ 2s. This is the reference we mimic **except** the
in-app-browser import direction, which our stories explicitly forbid.

## App shell (for orientation)
- **Bottom tab bar:** Recipes · Meal Plan · Groceries · Discover.
- **Top bar:** ReciMe wordmark (blue script) · "N left" import-quota pill · profile icon.
- **Recipes screen:** "Welcome / Let's get cooking!" onboarding checklist card (Import your
  first recipe / Unlock faster importing / Create your first cookbook, items strike through as
  done) → **Cookbooks** section (collapsible chevron) → cookbook tiles → floating blue **"+" FAB**
  bottom-right, above the tab bar.
- **Empty state:** big painterly food illustration, "Let's get cooking! Start by adding your
  first recipe", plus "Add a Recipe / Import from anywhere" and "Add a Cookbook" buttons.

## A. Import flow (the core)
1. **Tap FAB "+"** → bottom sheet "Add a recipe":
   - Hero row: "Import from social media / Share to ReciMe from social apps" (IG/TikTok/FB icons).
   - Grid: Import from photo · Import from text · Import from web · Write from scratch.
   - (A simpler variant sheet shows just "Add a Recipe" + "Add a Cookbook".)
2. **Import from web** → opens an **in-app browser** ("Google a recipe", search/paste-URL box,
   keyboard, "Open a recipe to import"). ⚠️ **This is the direction we must NOT copy.** The user
   browses to a site (Instagram shown), and a pinned blue **"Import to ReciMe"** bar with a "+"
   sits at the bottom of the web view. Tapping it starts the import.
3. **Import processing** → **preview/save screen**:
   - Header: "ReciMe [Cancel]". Banner: "5/5 smart imports left. Try Plus for free. Resets in 3 days."
   - Recipe card: thumbnail + title ("Maple Soy Chicken Thighs") + "Edit recipe".
   - **INGREDIENTS** list, each row = small per-ingredient **icon** + amount (bold) + name
     (e.g. "🐔 2 lb boneless, skinless chicken thighs", "🍋 1 lemon, zested").
   - "**Select cookbook >**" row.
   - Blue "**Save**" button (disabled until ready). "Report import mistake" link.
4. **Select cookbook** → "**Save to**" sheet: "+ New cookbook >" row + list of cookbooks with
   **checkboxes** ("Mains / 0 Recipes"). "Update" button commits selection.
5. **New cookbook** → sheet: Title field ("e.g. Weeknight Dinner", **0/50 char counter**),
   "Create cookbook" button **grey/disabled until text entered, blue when valid**.
6. Back on save screen the chosen cookbook shows as a removable **chip** ("Mains ×") above Save.
7. **Save** → loading ("•••" on the button) → **success celebration modal**: "Now you're
   cooking!" with confetti + checkmark art, "Save another recipe" button, "View recipe" link.

### Direct social-import education flow (alt path)
- FAB "+" → "Import from social media" → sheet lists **Instagram / TikTok / Facebook**.
- Picking Instagram → "Import from Instagram" card with sample image + animated "tap send" hint
  on the IG share icon, "Open Instagram to find a recipe" button, "Try with a sample recipe".
- Separate "Save recipes faster 🚀 / Add ReciMe to the share menu" iOS-share-extension setup
  walkthrough (Step 1 scroll → More, Step 2 Edit, Step 3 tap +). **Out of scope for our stories.**

## B. Recipe detail screen
- Header: back · Edit · "⋯" menu.
- Hero dish photo (camera icon overlay to change).
- Title. Action row: **Meal Plan · Groceries · Pin · Share**.
- RECIPE NOTES ("Open Instagram ↗", Add note).
- **COOKBOOKS**: green chips (e.g. "Mains") + Edit.
- "Mark as Cooked" + star rating.
- Servings stepper "− 4 + servings" · "Convert" (Plus) · "Ask ReciMe".
- **INGREDIENTS** grouped by section (Chicken & Marinade, Glaze), each row icon+amount+name.
  "Add items" sheet → checkbox list → "Add 13 items" (to groceries).
- **STEPS** numbered; **ingredient names inside a step render as green tappable links**
  (e.g. "chicken thighs", "rice") — tapping surfaces that ingredient's amount/icon. ← this is our
  "Show recipe" tap-ingredient-in-step requirement, with haptics.
- NUTRITION (Plus, blurred/locked). TAGS ("+ Add tags").

## C. Cookbook screen (Show cookbook)
- Header: back · share · "⋯". Title "Mains / 1 Recipe".
- Recipe **cards**: thumbnail + name. (Our "Show cookbook" = cards with thumbnail + name.)

## Micro-interactions worth copying
- Blue circular **FAB "+"** floating bottom-right above the tab bar.
- Bottom sheets: rounded top, grabber handle, slide up.
- **Per-ingredient icons/emoji** on every ingredient row.
- Cookbook selection = checkboxes; selected = removable chip near Save.
- **Save success = confetti "Now you're cooking!" celebration.**
- Loading states: top progress bar (web view) / "•••" on Save.
- Ingredient-in-step = **green highlighted inline link**, tap to reveal amount (+ haptic for us).

## Our divergences (locked by the stories / AGENTS.md)
- **NO in-app browser.** Replace steps 2–3 with: FAB "+" → simple **"paste a link" modal** →
  **auto-import on paste/submit** → straight to the preview/save screen.
- **Vintage golden-hour** theme + tokens (no `bg-white`; `bg-card` surfaces), not Recime's
  white/blue. Wordmark = Lora, body = Karla. FAB/interactive = amber `bg-brand`, not blue.
- Friendly error copy per stories: no recipe → "We don't think this contains a recipe";
  timeout/failure → "Oops let's try that again".
