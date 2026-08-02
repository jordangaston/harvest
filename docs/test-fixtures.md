---
title: "Integration Test Fixtures — Recipe Import Corpus"
feature: harvest-core
status: draft
date: 2026-08-02
note: "Real public posts pulled via the Apify MCP on 2026-08-02, bucketed by the pipeline path each must exercise (O-08). Use as the regression corpus for the parse pipeline and the BR-04 threshold tuning (Q-06/Q-11). Re-verify URLs before a test run — social posts get deleted."
---

# Integration Test Fixtures — Recipe Import Corpus

These are **real** public posts, discovered and vetted with the Apify MCP, chosen so the set covers
every branch of the parse pipeline (O-08) and every use-case extension (F-03/F-04/F-05). Each row lists
the expected **tier/path** and the **expected outcome** so tests can assert both the route taken and the
result. Capture each post's scraped payload once and store it as a recorded fixture (so tests run
offline against stubbed providers — see the design's Testing section).

## Legend — expected pipeline path
- **T0** = Tier-0 free caption (TikTok oEmbed / website JSON-LD), extract from text, no video.
- **T1** = Tier-1 Apify caption (IG/FB), extract from text, no video.
- **T2-ASR** = escalate to video, recipe is in **spoken audio** → Groq Whisper.
- **T2-VIS** = escalate to video/images, recipe is in **on-screen/overlay/carousel text** → Qwen-VL.
- **WEB** = caption carries an outbound link → follow to the site → O-03 JSON-LD/LLM.
- **NONE** = no recipe present → `no_recipe`.

---

## 1. Caption-complete — ingredients + steps in caption → short-circuit (T0/T1)

| Platform | URL | Notes | Expect |
|---|---|---|---|
| TikTok | https://www.tiktok.com/@caitlynskitchen/video/7663645567339334943 | Crockpot Chicken Teriyaki — full ingredients + 7 numbered steps | T0 → recipe, `total_minutes` set |
| TikTok | https://www.tiktok.com/@cookinginthemidwest/video/7669051933277097247 | Chicken Bacon Ranch Pasta Bake — full ingredients + instructions | T0 → recipe |
| TikTok | https://www.tiktok.com/@jonwatts88/video/7666468109997427990 | Creamy Sausage Pasta — full recipe in caption, **14s video** (proves caption suffices even w/ a tiny clip) | T0 → recipe, **no video fetched** |
| TikTok | https://www.tiktok.com/@jonwatts88/video/7668502068558204162 | Creamy Garlic & Paprika Chicken — full ingredients + steps | T0 → recipe |
| TikTok | https://www.tiktok.com/@nutritionwithnat_/video/7665843047481085197 | Honey Sesame Chicken — full ingredients + method + servings | T0 → recipe, servings parsed |
| Instagram | https://www.instagram.com/p/Dbi_HX7RZBN/ | Red Potato Salad — full numbered steps in caption (image post) | T1 → recipe |
| Instagram | https://www.instagram.com/p/Dbi-2r2Ma-W/ | Parmigiana di zucchine — full ingredients, **Italian** (i18n) | T1 → recipe, non-English |

## 2. Partial caption — ingredients only, no steps → may escalate for method

| Platform | URL | Notes | Expect |
|---|---|---|---|
| TikTok | https://www.tiktok.com/@zachs.foods/video/7664647835589086495 | French Onion Mac & Cheese — ingredient list, **no method** ("full recipe in bio") | T0 extract; low completeness → T2 for steps |
| TikTok | https://www.tiktok.com/@essen.recipes.official/video/7664636000206982413 | Ground Beef Stroganoff — ingredients + prose, no numbered steps | T0; borderline completeness (BR-04 tuning) |

## 3. Terse micro-recipe in one line — quantity parsing stress test

| Platform | URL | Notes | Expect |
|---|---|---|---|
| TikTok | https://www.tiktok.com/@thebigmansworld_official/video/7581580608825003271 | "1c butter + 2c flour + ⅔c powdered sugar → mix, pipe, bake 15 min @350°F" — full micro-recipe inline | T0 → recipe; tests fraction/unit parsing (⅔c, °F) |
| TikTok | https://www.tiktok.com/@justa.little.bite/video/7658420242007330068 | 3-ingredient banana bread — names ingredients in prose, **no quantities** | T0 low confidence → T2-ASR/VIS |

## 4. Caption thin/absent — recipe only in the video → escalate (T2)

| Platform | URL | Notes | Expect |
|---|---|---|---|
| TikTok | https://www.tiktok.com/@cici.soriano/video/7662144309986086158 | "Crispy cheesy beef taquitos 🔥" — title only, 74s | T2-ASR/VIS → recipe |
| TikTok | https://www.tiktok.com/@easy.food.recieps/video/7665066361650990350 | Hashtags only, **14-min** video — pure video parse | T2-ASR/VIS; long-clip latency/cost stress |
| Instagram | https://www.instagram.com/p/Dbi_VuygdfS/ | "Full method is in the carousel, swipe through" — recipe lives in **carousel images**, not caption | **T2-VIS** (read carousel images) |

## 5. Caption → outbound website link → website fallback (WEB / F-04 3b)

| Platform | URL | Outbound target | Expect |
|---|---|---|---|
| TikTok | https://www.tiktok.com/@i.am.never.full/video/7664282251605183774 | explicit URL: iamneverfull.com/garlic-butter-fried-rice-recipe/ | WEB → JSON-LD recipe |
| TikTok | https://www.tiktok.com/@boldbeanco/video/7664997245695069463 | "Recipe on our website" (boldbean.co) | WEB or T2 fallback |
| Instagram | https://www.instagram.com/p/Dbi_3nhivaD/ | substack link (carrotsandtigers.substack.com) | WEB → recipe |

## 6. Pinterest — image pin + outbound link → website path (Q-01 resolved)

**Q-01 finding:** the `dltik/pinterest-scraper` `videos` scope returned **no pins** (twice, incl. residential
proxy), and the actor exposes **no `video_url`** — only `image_url`, `is_video`, and an outbound `link`.
⇒ Pinterest is handled as **image + outbound link → website path**; no Pinterest video branch. These pins
double as **website-import (O-03) fixtures** — each `link` is a real recipe blog with JSON-LD.

| Pin URL | Outbound recipe site | Expect |
|---|---|---|
| https://www.pinterest.com/pin/68750145082/ | theferventmama.com/garlic-parmesan-chicken-and-potatoes/ | WEB → recipe |
| https://www.pinterest.com/pin/351912467487215/ | zoedish.com/creamy-smothered-chicken-and-rice/ | WEB → recipe |
| https://www.pinterest.com/pin/1125968743409967/ | crispcrumbs.com/garlic-herb-chicken | WEB → recipe |
| https://www.pinterest.com/pin/2040762329480639/ | thecozycook.com/creamy-garlic-chicken/ | WEB → recipe |
| https://www.pinterest.com/pin/98023729385088753/ | jz-eats.com/honey-butter-chicken/ | WEB → recipe |

## 7. Negative / edge controls — expect `no_recipe` or special handling

| Platform | URL | Notes | Expect |
|---|---|---|---|
| TikTok | https://www.tiktok.com/@naturaltricksformen/video/7667291236641934606 | "Full recipe… 'stallion gelatin hack'" — engagement bait, not a real recipe | **NONE** (`no_recipe`, guards BR-04) |
| Instagram | https://www.instagram.com/p/Dbi_dcTDmhH/ | Romanian meal-prep post, **no recipe**, non-English | **NONE** or i18n no-recipe |

---

## Provider notes captured while building this corpus
- **TikTok** (`clockworks/free-tiktok-scraper`): search by `searchQueries` + `searchSection:/video` works;
  returns `text` (caption), `webVideoUrl`, `videoMeta.duration`, `videoMeta.subtitleLinks` (subtitle
  availability = an ASR-content signal), `videoMeta.coverUrl` (thumbnail). Fast (~17s for 18 videos).
- **Pinterest** (`dltik/pinterest-scraper`): needs `proxyConfig` **RESIDENTIAL** (datacenter IPs throttle →
  "No pins returned"). `pins` scope returns `link`/`domain`/`image_url`/`is_video`/`title`/`description`.
  **`videos` scope returned nothing** — see Q-01.
- **Instagram** (`apify/instagram-scraper`): hashtag *search* returns a hashtag wrapper; use `directUrls`
  with the tag URL (`/explore/tags/<tag>/`) for flat posts. **`videoUrl`/reel download needs a paid Apify
  plan** — free returns `caption` + `displayUrl` (thumbnail) + `type` only. Flag for the ingestion budget.
