---
tags: [harvest, onboarding], teardown
summary: "Interaction teardowns of the Miso and Herbi onboarding flows, with steal / improve calls cited to Refactoring UI"
locked: false
---

# Reference Onboarding Teardowns

Two competitor onboardings, studied frame-by-frame (60 fps screen recordings, sampled every 2 s):
`~/Downloads/miso-onboarding.mp4` (122 s) and `~/Downloads/herbi-onboarding.mp4` (174 s).

- **Miso** is the *polish* reference — a dark theme whose value is in motion, typography, and
  reassurance copy. We steal its **feel**.
- **Herbi** is the *content* reference — a light theme (cream + green) whose value is in *which
  questions it asks and how it shapes the answer*. We steal its **intake**.

Each call names the Refactoring UI guideline (chapter + title) behind it, per the framework's rule:
*not talent, tactics — name the fix, don't gesture at taste.*

Frames referenced below live in the session scratchpad contact sheets (`miso_sheet_*.png`,
`herbi_sheet_*.png`); re-extract with the `ffmpeg … fps=1/2,tile=6x6` command in the sprint log.

---

## Miso

### 1. The "In One Place" loading screen (animated value-prop)

A ring of 3D food (baguette, mushroom, tomato, spaghetti) orbits a centred headline that swaps
"In One Place" → "Welcome to **Miso**." The motion runs *while the app boots* — the wait becomes the
pitch.

**Steal:**
- **Turn dead time into hierarchy.** One dominant centred headline, everything else (the orbiting
  food) is decoration that recedes. *(Ch2: Hierarchy — emphasise by de-emphasising; the food is
  supporting, sized and positioned so the words win the Squint Test.)*
- **A single accent word carries the brand.** "**Miso**" is the one coloured token in an otherwise
  monochrome line. *(Ch5: Color — use colour for meaning, sparingly; one accent beats a rainbow.)*

**Improve:**
- Miso's orbit is a looping video; at Harvest's scale that's an expensive Higgsfield asset for a
  3-second moment. Do it in code (`Animated` rotate on a ring of PNG food tokens) — cheaper, honours
  Reduce Motion for free, and stays crisp at any density. *(Ch1: Limit your choices — a code motion
  system you already own beats a bespoke render.)*
- The dark canvas makes the food *pop* but fights our golden-hour identity. Re-skin to `bg-cream`
  with the food lit from above and a soft `ELEVATION.high` shadow so the tokens feel physical rather
  than neon. *(Ch6: Creating Depth — light-from-above shadow, not glow.)*

### 2. Typing effect + haptics — *only on informational cards*

Miso's headline text types character-by-character with a light haptic tick per character on the
**informational** screens ("Welcome to Miso…", "Dietary info **will be clearly visible** on each
recipe."). The **interactive** screens (goals, age, source pickers) render their headings instantly —
no typing, no haptic. The rule is consistent and load-bearing: *typing says "read me," and you never
make someone wait to type an answer.*

**Steal — wholesale.** This is the single best idea in either video.
- Typing builds a reading *rhythm* and directs the eye to the one thing that matters on a
  content-only screen. *(Ch2: Hierarchy — on a screen with no competing controls, motion is the
  hierarchy.)*
- Reserving the effect for informational cards is itself a hierarchy system: the *presence* of typing
  tells the user "nothing to do here but absorb," its *absence* says "your turn." *(Ch1: Limit your
  choices — one binary rule, applied everywhere, reads as intentional.)*

**Improve:**
- Miso types the *whole* line including punctuation, which drags. Type the headline only; fade the
  supporting line in underneath after the headline lands. *(Ch4: Designing Text — establish a size/
  weight hierarchy so the two lines don't compete.)*
- Haptic-per-character can buzz on a long line. Cap it: a `selection` tick every ~2 characters, and a
  single `notificationAsync(Success)` when the line completes. Honour `isReduceMotionEnabled` → render
  the full string instantly, no ticks.

### 3. The asymmetric "Saved. Forgotten. Never cooked." reveal

The headline builds in beats — "Saved." then "**Forgotten.**" then "Never cooked." — while four
problem cards ("Recipes saved everywhere," "I cook the same every week," "Scrolling leads to takeout,"
"Eating healthy feels hard") drop in **one at a time, staggered**, not as a grid.

**Steal:**
- **Staggered reveal = manufactured hierarchy over time.** Four equal cards shown at once read as one
  grey mass; revealed in sequence, each gets its own moment. *(Ch2: Hierarchy is everything — the
  stagger is what stops the list flattening.)*
- **The em-word colour shift** ("**Forgotten.**" in the accent) turns a headline into a three-act
  story with one styling trick. *(Ch5: Color for meaning; Ch4: weight/colour for emphasis, not size.)*

**Improve:**
- The cards are `bg-white` on near-black — high contrast but off-brand. On our cream canvas the same
  cards become `bg-card` lifting on `ELEVATION.low`; the stagger still separates them because *depth,
  not colour, does the separating*. *(Ch6: Creating Depth — a light-on-light system separates by
  shadow; Ch8: Finishing Touches — kill the borders, let the shadow define the edge.)*
- Keep the stagger to ≤4 cards and ~60 ms apart; more and it stops feeling deliberate and starts
  feeling slow. *(Ch3: Layout & Spacing — a constrained rhythm reads as a system.)*

### 4. "How did you hear about us?" fade-in

A vertical list of channels (Instagram, TikTok, Facebook, From Influencer, App Store Search, Friends
& Family, Cooking show/TV) fades in row-by-row, each row a real logo + label on a lifted tile.

**Steal:**
- **Row-by-row fade turns a boring attribution question into a considered one** and, again, is
  hierarchy-over-time. *(Ch2: Hierarchy — sequence the reveal so the eye lands one row at a time.)*
- **Real logos, not generic dots.** A recognisable brand mark is an instant, language-free label.
  *(Ch7: Working with Images — an icon/logo is a faster label than text; Ch5 — never rely on colour
  or shape alone, pair the mark with its name.)*

**Improve:**
- Attribution ("how did you hear") collects zero ranking signal. Keep it if marketing needs it, but
  push it *after* the value-delivering questions so the first taps the user makes personalise their
  deck. *(Ch1: Start with the feature — front-load the screens that earn the user something.)*

### 5. Bonus steals Miso does quietly

- **Contextual microcopy on selection.** Pick "25–34" and the screen answers "You'll fit right in.
  37% of Miso users are between 25 and 34." Pick "Just getting started" and it reassures "Lots of
  Miso users are just starting out too." The choice is *acknowledged*, which lowers the fear that a
  wrong answer breaks something. **Steal for the skill-level screen.** *(Ch8: Finishing Touches —
  the considered detail that signals care; Ch2 — the microcopy is de-emphasised, secondary text so it
  supports without competing.)*
- **Confirmation microcopy after a choice.** "Got it. We'll mark **fish-friendly** recipes for you."
  closes the loop between an answer and a consequence. **Steal for diet/allergen screens.**

---

## Herbi

### 6. Grocery-store selector ("choose your shop")

A grid of nine real US store logos as **brand-coloured tiles** — Walmart (blue), Target (red), Whole
Foods (green), Aldi, Kroger, Safeway, Publix, Trader Joe's, Costco.

**Steal:**
- **Brand tiles are self-labelling and instantly scannable** — you find *your* store by its colour
  before you read a word. *(Ch7: Working with Images — a logo is a faster label than a text row; Ch5
  — the brand colour is meaning, and it's the brand's, not ours to invent.)*
- **A tidy grid on a constrained tile size** reads as a system, not a dump. *(Ch3: Layout & Spacing —
  fixed tile dimensions on a spacing scale.)*

**Improve:**
- Full-saturation competitor logos on our warm cream will vibrate — nine loud brand colours violate
  "colour = meaning, spent sparingly." Render each logo on its own `bg-card` tile with a hairline and
  `ELEVATION.low`, and let *selection* (our terracotta `border-brand` + `bg-brand-light`) be the only
  Harvest colour on the screen. The competitor colour lives *inside* the tile; our colour marks the
  *choice*. *(Ch5: Color — separate "their brand" from "our state"; Ch8 — a selected accent border is
  the finishing touch that says "chosen.")*
- Nine stores isn't exhaustive. Add a searchable "More stores" sheet (reuse the existing
  `SearchAddSheet`) and an "I shop somewhere else / skip" escape so the screen never traps a user
  whose store isn't shown. *(Ch8: design the empty/edge state first-class.)*

### 7. People-count ("how many are you cooking for?")

One giant number ("**3** people") with a −/＋ stepper and three little face emoji that grow with the
count. "We'll size every portion right" sits underneath as the promise.

**Steal:**
- **One enormous number is unambiguous and delightful.** The value *is* the screen. *(Ch2: Hierarchy
  — make the most important thing the biggest thing; Ch4 — a display-size numeral earns the top of the
  type scale.)*
- **The promise line reframes a chore as a benefit** ("we'll size every portion right"). *(Ch1:
  personality through language — the copy sells while it asks.)*

**Improve — this is the screen we most change:**
- Herbi collects a *single* head-count; our ranking and portioning want the **adults vs. kids** split
  (kids' meals is already a `WeeklyMeals` slot, and budget-per-serving differs). Show **two** stepper
  rows, "Adults" and "Kids," each with the big-number treatment, sharing one card. *(Ch3 — group the
  two rows in one card with internal spacing tighter than the card's outer padding, so they read as
  one question; Ch2 — keep the numbers the visual anchor.)*
- The growing face emoji is cute but caps out; drop it for a calm numeral so 2 kids and 6 kids look
  equally intentional. *(Ch8: don't let a decoration undermine the data.)*

### 8. "What's in your kitchen?"

An **isometric 3D kitchen** illustration with tappable appliance hotspots (microwave, air fryer, slow
cooker, oven…) that highlight green when selected.

**Steal — the *intent*, not the *execution*:**
- **Framing equipment as "what you've got" is warmer than a checklist** and the promise "tap only what
  you've got or want to use" removes the fear of over-committing. *(Ch1: personality via language.)*
- **Direct manipulation of a picture of the thing** is more legible than words for physical objects.
  *(Ch7: images as labels.)*

**Improve — regress to a chip grid, deliberately:**
- A bespoke isometric scene with pixel-placed hotspots is a heavy illustration + a fragile hit-target
  map, and it can't cover all 14 `EQUIPMENT_TYPES` without clutter. A labelled chip grid (icon + name)
  maps 1:1 to the server enum, scales to the long tail via "More…", and reuses the `Chip` we already
  ship. *(Ch1: Limit your choices — reuse the system you own; Ch5 — pair every icon with a text label,
  never icon-alone.)* We already made this exact call for the swipe Settings "My kitchen" card;
  onboarding should match it, not diverge.
- If we later want delight here, the cheap upgrade is a small painterly appliance icon per chip (Nano
  Banana), not a full scene. Flagged as an optional asset, not a blocker.

### 9. Bonus steals Herbi does well

- **Budget as a big number + slider.** "$155 **this week**" in display type over a `$30–$300+` track
  with a money-bag thumb. The number is the hero; the slider is the control. **Steal for the budget
  screen** — and we already own the `Slider` primitive. *(Ch2: hierarchy — value dominates control;
  Ch4: display-size numeral.)*
- **Day-picker with a live counter.** Weekday chips with "6 dinners this week" updating beneath, and a
  "Pick at least one day" guard. **Steal for the cook-days screen** — the live count is instant
  feedback that the answer *does something*. *(Ch8: Finishing Touches — the small live detail; Ch2 —
  the count is secondary text under the primary chips.)*
- **Pastel "vibe" chips** (Quick & Easy, High Protein, Family Favourites…) each a soft tint with an
  icon. Confirms our multi-select chip archetype — but on cream we use *one* selected tint
  (`bg-brand-light`), not seven pastels, so selection stays unambiguous. *(Ch5: colour = meaning;
  seven tints dilute it.)*
- **Free-text + common-picks** for "anything you'd rather skip?" (a text field over
  Mushrooms/Shellfish/Peanuts… chips). **Steal for disliked-ingredients** — reuses `SearchAddSheet`
  + `Chip`.
- **Checklist loader** ("Analysing budget + preferences → Building your meal plan → Generating
  shopping list") turns the final wait into visible progress. **Steal for the hand-off** into the
  deck. *(Ch2: sequence draws the eye down the list; Ch8: progress as a finishing touch.)*

---

## Net calls

| From | Steal | Change on the way in |
|---|---|---|
| Miso | Typing + haptics on informational cards *only* | Type headline only; cap haptic cadence; Reduce-Motion → instant |
| Miso | Orbiting-food loader | Rebuild in `Animated` (code, not video); re-skin to golden-hour |
| Miso | Staggered problem-card reveal + accent em-word | Cream `bg-card` + `ELEVATION.low`, depth not colour; ≤4 cards |
| Miso | Contextual + confirmation microcopy | Apply to skill/diet/allergen screens |
| Herbi | Real-logo store grid | Our state-colour ≠ their brand-colour; add search + skip |
| Herbi | Big-number + slider budget | Reuse existing `Slider` |
| Herbi | People count | Split **adults / kids**; drop growing emoji |
| Herbi | "What's in your kitchen" intent | Chip grid → `EQUIPMENT_TYPES`, not a 3D scene |
| Herbi | Day-picker w/ live count, common-picks, checklist loader | Reuse `Chip` / `SearchAddSheet`; one selected tint |

The through-line: **Miso's motion, Herbi's questions, Harvest's cream-and-shadow surface, and every
answer landing in the preference model we already ship.**
