import { useSyncExternalStore } from "react";
import type { ImageSourcePropType } from "react-native";

export type Recipe = {
  id: string;
  title: string;
  image: ImageSourcePropType;
  source: string; // e.g. "Imported from Instagram"
  rating: string; // e.g. "4.8"
  time: string; // e.g. "3 hr 15 min"
  servings: number;
  ingredients: { icon: ImageSourcePropType; text: string }[];
  steps: string[];
};

// Painterly golden-hour ingredient icons, keyed by name.
const ICON = {
  oliveOil: require("../../assets/ingredients/olive-oil.jpg"),
  bacon: require("../../assets/ingredients/bacon.jpg"),
  beef: require("../../assets/ingredients/beef.jpg"),
  carrot: require("../../assets/ingredients/carrot.jpg"),
  onion: require("../../assets/ingredients/onion.jpg"),
  garlic: require("../../assets/ingredients/garlic.jpg"),
  salt: require("../../assets/ingredients/salt.jpg"),
  pepper: require("../../assets/ingredients/pepper.jpg"),
  flour: require("../../assets/ingredients/flour.jpg"),
  redWine: require("../../assets/ingredients/red-wine.jpg"),
  beefStock: require("../../assets/ingredients/beef-stock.jpg"),
  tomatoPaste: require("../../assets/ingredients/tomato-paste.jpg"),
  bouillon: require("../../assets/ingredients/bouillon.jpg"),
  thyme: require("../../assets/ingredients/thyme.jpg"),
  banana: require("../../assets/ingredients/banana.jpg"),
  butter: require("../../assets/ingredients/butter.jpg"),
  brownSugar: require("../../assets/ingredients/brown-sugar.jpg"),
  egg: require("../../assets/ingredients/egg.jpg"),
  bakingSoda: require("../../assets/ingredients/baking-soda.jpg"),
  cinnamon: require("../../assets/ingredients/cinnamon.jpg"),
  vanilla: require("../../assets/ingredients/vanilla.jpg"),
  walnuts: require("../../assets/ingredients/walnuts.jpg"),
  // Expanded common-ingredient set (painterly golden-hour, matches the above).
  chicken: require("../../assets/ingredients/chicken.jpg"),
  pork: require("../../assets/ingredients/pork.jpg"),
  fish: require("../../assets/ingredients/fish.jpg"),
  shrimp: require("../../assets/ingredients/shrimp.jpg"),
  cheese: require("../../assets/ingredients/cheese.jpg"),
  rice: require("../../assets/ingredients/rice.jpg"),
  pasta: require("../../assets/ingredients/pasta.jpg"),
  potato: require("../../assets/ingredients/potato.jpg"),
  tomato: require("../../assets/ingredients/tomato.jpg"),
  cream: require("../../assets/ingredients/cream.jpg"),
  milk: require("../../assets/ingredients/milk.jpg"),
  sugar: require("../../assets/ingredients/sugar.jpg"),
  honey: require("../../assets/ingredients/honey.jpg"),
  soySauce: require("../../assets/ingredients/soy-sauce.jpg"),
  lemon: require("../../assets/ingredients/lemon.jpg"),
  lime: require("../../assets/ingredients/lime.jpg"),
  ginger: require("../../assets/ingredients/ginger.jpg"),
  scallion: require("../../assets/ingredients/scallion.jpg"),
  chili: require("../../assets/ingredients/chili.jpg"),
  mushroom: require("../../assets/ingredients/mushroom.jpg"),
  parsley: require("../../assets/ingredients/parsley.jpg"),
  basil: require("../../assets/ingredients/basil.jpg"),
  bellPepper: require("../../assets/ingredients/bell-pepper.jpg"),
  broccoli: require("../../assets/ingredients/broccoli.jpg"),
  spinach: require("../../assets/ingredients/spinach.jpg"),
  stock: require("../../assets/ingredients/stock.jpg"),
  paprika: require("../../assets/ingredients/paprika.jpg"),
  cumin: require("../../assets/ingredients/cumin.jpg"),
  oregano: require("../../assets/ingredients/oregano.jpg"),
  mustard: require("../../assets/ingredients/mustard.jpg"),
  sesameOil: require("../../assets/ingredients/sesame-oil.jpg"),
  cornstarch: require("../../assets/ingredients/cornstarch.jpg"),
  // W2 grocery fruit set (painterly golden-hour, matches the above).
  apple: require("../../assets/ingredients/apple.jpg"),
  orange: require("../../assets/ingredients/orange.jpg"),
  grape: require("../../assets/ingredients/grape.jpg"),
  grapefruit: require("../../assets/ingredients/grapefruit.jpg"),
  strawberry: require("../../assets/ingredients/strawberry.jpg"),
  blueberry: require("../../assets/ingredients/blueberry.jpg"),
  raspberry: require("../../assets/ingredients/raspberry.jpg"),
  blackberry: require("../../assets/ingredients/blackberry.jpg"),
  pineapple: require("../../assets/ingredients/pineapple.jpg"),
  mango: require("../../assets/ingredients/mango.jpg"),
  peach: require("../../assets/ingredients/peach.jpg"),
  pear: require("../../assets/ingredients/pear.jpg"),
  cherry: require("../../assets/ingredients/cherry.jpg"),
  watermelon: require("../../assets/ingredients/watermelon.jpg"),
  cantaloupe: require("../../assets/ingredients/cantaloupe.jpg"),
  avocado: require("../../assets/ingredients/avocado.jpg"),
  kiwi: require("../../assets/ingredients/kiwi.jpg"),
  // W2 grocery set: vegetables, herbs, proteins, dairy, pantry (painterly golden-hour).
  coconut: require("../../assets/ingredients/coconut.jpg"),
  cranberry: require("../../assets/ingredients/cranberry.jpg"),
  apricot: require("../../assets/ingredients/apricot.jpg"),
  fig: require("../../assets/ingredients/fig.jpg"),
  date: require("../../assets/ingredients/date.jpg"),
  raisin: require("../../assets/ingredients/raisin.jpg"),
  celery: require("../../assets/ingredients/celery.jpg"),
  cucumber: require("../../assets/ingredients/cucumber.jpg"),
  zucchini: require("../../assets/ingredients/zucchini.jpg"),
  cauliflower: require("../../assets/ingredients/cauliflower.jpg"),
  cabbage: require("../../assets/ingredients/cabbage.jpg"),
  lettuce: require("../../assets/ingredients/lettuce.jpg"),
  kale: require("../../assets/ingredients/kale.jpg"),
  corn: require("../../assets/ingredients/corn.jpg"),
  peas: require("../../assets/ingredients/peas.jpg"),
  greenBeans: require("../../assets/ingredients/green-beans.jpg"),
  asparagus: require("../../assets/ingredients/asparagus.jpg"),
  eggplant: require("../../assets/ingredients/eggplant.jpg"),
  sweetPotato: require("../../assets/ingredients/sweet-potato.jpg"),
  beet: require("../../assets/ingredients/beet.jpg"),
  radish: require("../../assets/ingredients/radish.jpg"),
  squash: require("../../assets/ingredients/squash.jpg"),
  pumpkin: require("../../assets/ingredients/pumpkin.jpg"),
  brusselsSprouts: require("../../assets/ingredients/brussels-sprouts.jpg"),
  leek: require("../../assets/ingredients/leek.jpg"),
  okra: require("../../assets/ingredients/okra.jpg"),
  cilantro: require("../../assets/ingredients/cilantro.jpg"),
  mint: require("../../assets/ingredients/mint.jpg"),
  rosemary: require("../../assets/ingredients/rosemary.jpg"),
  sage: require("../../assets/ingredients/sage.jpg"),
  dill: require("../../assets/ingredients/dill.jpg"),
  arugula: require("../../assets/ingredients/arugula.jpg"),
  cabbageNapa: require("../../assets/ingredients/cabbage-napa.jpg"),
  turkey: require("../../assets/ingredients/turkey.jpg"),
  lamb: require("../../assets/ingredients/lamb.jpg"),
  duck: require("../../assets/ingredients/duck.jpg"),
  sausage: require("../../assets/ingredients/sausage.jpg"),
  ham: require("../../assets/ingredients/ham.jpg"),
  crab: require("../../assets/ingredients/crab.jpg"),
  lobster: require("../../assets/ingredients/lobster.jpg"),
  scallop: require("../../assets/ingredients/scallop.jpg"),
  clam: require("../../assets/ingredients/clam.jpg"),
  mussel: require("../../assets/ingredients/mussel.jpg"),
  oyster: require("../../assets/ingredients/oyster.jpg"),
  tuna: require("../../assets/ingredients/tuna.jpg"),
  salmon: require("../../assets/ingredients/salmon.jpg"),
  cod: require("../../assets/ingredients/cod.jpg"),
  tofu: require("../../assets/ingredients/tofu.jpg"),
  yogurt: require("../../assets/ingredients/yogurt.jpg"),
  sourCream: require("../../assets/ingredients/sour-cream.jpg"),
  creamCheese: require("../../assets/ingredients/cream-cheese.jpg"),
  mozzarella: require("../../assets/ingredients/mozzarella.jpg"),
  cheddar: require("../../assets/ingredients/cheddar.jpg"),
  parmesan: require("../../assets/ingredients/parmesan.jpg"),
  feta: require("../../assets/ingredients/feta.jpg"),
  cottageCheese: require("../../assets/ingredients/cottage-cheese.jpg"),
  buttermilk: require("../../assets/ingredients/buttermilk.jpg"),
  oats: require("../../assets/ingredients/oats.jpg"),
  quinoa: require("../../assets/ingredients/quinoa.jpg"),
  breadcrumbs: require("../../assets/ingredients/breadcrumbs.jpg"),
  cornmeal: require("../../assets/ingredients/cornmeal.jpg"),
  couscous: require("../../assets/ingredients/couscous.jpg"),
  barley: require("../../assets/ingredients/barley.jpg"),
  lentil: require("../../assets/ingredients/lentil.jpg"),
  chickpea: require("../../assets/ingredients/chickpea.jpg"),
  blackBeans: require("../../assets/ingredients/black-beans.jpg"),
  kidneyBeans: require("../../assets/ingredients/kidney-beans.jpg"),
  pintoBeans: require("../../assets/ingredients/pinto-beans.jpg"),
  peanut: require("../../assets/ingredients/peanut.jpg"),
  almond: require("../../assets/ingredients/almond.jpg"),
  cashew: require("../../assets/ingredients/cashew.jpg"),
  pecan: require("../../assets/ingredients/pecan.jpg"),
  pistachio: require("../../assets/ingredients/pistachio.jpg"),
  sunflowerSeed: require("../../assets/ingredients/sunflower-seed.jpg"),
  chiaSeed: require("../../assets/ingredients/chia-seed.jpg"),
  sesameSeed: require("../../assets/ingredients/sesame-seed.jpg"),
  vegetableOil: require("../../assets/ingredients/vegetable-oil.jpg"),
  coconutOil: require("../../assets/ingredients/coconut-oil.jpg"),
  vinegar: require("../../assets/ingredients/vinegar.jpg"),
  ketchup: require("../../assets/ingredients/ketchup.jpg"),
  mayonnaise: require("../../assets/ingredients/mayonnaise.jpg"),
  // W2 grocery catalog icons (nano-banana painterly set).

  // Branded generic fallback — the Harvest "H" in the same painterly style.
  harvestH: require("../../assets/ingredients/harvest-h.jpg"),
};

/**
 * Resolves a server icon key (from mapIngredientIcon) to a painterly asset. Falls
 * back to the branded Harvest-H icon for the `default` key and anything outside the
 * set, so every ingredient always shows a real painterly icon (never a blank).
 */
export function resolveIcon(key?: string | null): ImageSourcePropType {
  const asset = key ? (ICON as Record<string, ImageSourcePropType>)[key] : undefined;
  return asset ?? ICON.harvestH;
}

// The sample recipe used by "Try with a sample recipe" (mirrors the demo).
export const SAMPLE_RECIPE: Recipe = {
  id: "beef-bourguignon",
  title: "Beef Bourguignon",
  image: require("../../assets/recipe-bourguignon.jpg"),
  source: "Imported from Instagram",
  rating: "4.8",
  time: "3 hr 15 min",
  servings: 6,
  ingredients: [
    { icon: ICON.oliveOil, text: "1 tablespoon extra-virgin olive oil" },
    { icon: ICON.bacon, text: "6 ounces bacon, roughly chopped" },
    { icon: ICON.beef, text: "3 pounds beef brisket, trimmed and cut into 2-inch chunks" },
    { icon: ICON.carrot, text: "1 large carrot, sliced 1/2-inch thick" },
    { icon: ICON.onion, text: "1 large white onion, diced" },
    { icon: ICON.garlic, text: "6 cloves garlic, minced (divided)" },
    { icon: ICON.salt, text: "1 pinch coarse salt" },
    { icon: ICON.pepper, text: "1 pinch ground pepper" },
    { icon: ICON.flour, text: "2 tablespoons flour" },
    { icon: ICON.onion, text: "12 small pearl onions, optional" },
    { icon: ICON.redWine, text: "3 cups red wine, like Merlot or Pinot Noir" },
    { icon: ICON.beefStock, text: "2 cups beef stock" },
    { icon: ICON.tomatoPaste, text: "2 tablespoons tomato paste" },
    { icon: ICON.bouillon, text: "1 beef bouillon cube, crushed" },
    { icon: ICON.thyme, text: "1 teaspoon fresh thyme, finely chopped" },
  ],
  steps: [
    "Pat the beef dry and season all over with salt and pepper.",
    "Sear the bacon in a Dutch oven until crisp, then set aside.",
    "Brown the beef in batches in the bacon fat; set aside with the bacon.",
    "Sauté the carrot, onion, and garlic until softened.",
    "Stir in the tomato paste and flour and cook for 1 minute.",
    "Deglaze with the red wine, scraping up the browned bits.",
    "Return the beef and bacon, then add the stock, bouillon, and thyme.",
    "Cover and braise at 325°F for 2½–3 hours, until fork-tender.",
    "Add the pearl onions during the last 30 minutes of cooking.",
    "Skim the sauce, adjust the seasoning, and serve warm.",
  ],
};

// Second sample used by the website-import demo.
export const BANANA_BREAD_RECIPE: Recipe = {
  id: "banana-walnut-bread",
  title: "Banana Walnut Bread",
  image: require("../../assets/recipe-banana-bread.jpg"),
  source: "Imported from the nom kitchen",
  rating: "4.9",
  time: "1 hr 15 min",
  servings: 8,
  ingredients: [
    { icon: ICON.banana, text: "3 ripe bananas, mashed" },
    { icon: ICON.butter, text: "1/2 cup butter, melted" },
    { icon: ICON.brownSugar, text: "3/4 cup brown sugar" },
    { icon: ICON.egg, text: "2 large eggs, beaten" },
    { icon: ICON.flour, text: "1 1/2 cups all-purpose flour" },
    { icon: ICON.bakingSoda, text: "1 teaspoon baking soda" },
    { icon: ICON.salt, text: "1 pinch salt" },
    { icon: ICON.cinnamon, text: "1 teaspoon ground cinnamon" },
    { icon: ICON.vanilla, text: "1 teaspoon vanilla extract" },
    { icon: ICON.walnuts, text: "3/4 cup walnuts, chopped" },
  ],
  steps: [
    "Preheat the oven to 350°F and grease a loaf pan.",
    "Mash the bananas in a large bowl until smooth.",
    "Stir in the melted butter, brown sugar, eggs, and vanilla.",
    "In another bowl, whisk the flour, baking soda, salt, and cinnamon.",
    "Fold the dry ingredients into the wet until just combined.",
    "Stir in the chopped walnuts, saving a few for the top.",
    "Pour into the loaf pan and scatter the reserved walnuts.",
    "Bake for 55–60 minutes, until a toothpick comes out clean.",
    "Cool in the pan for 10 minutes, then turn out onto a rack.",
    "Slice and serve warm.",
  ],
};

export const RECIPES_BY_ID: Record<string, Recipe> = {
  [SAMPLE_RECIPE.id]: SAMPLE_RECIPE,
  [BANANA_BREAD_RECIPE.id]: BANANA_BREAD_RECIPE,
};

let saved: Recipe[] = [];
const listeners = new Set<() => void>();

export function saveRecipe(recipe: Recipe) {
  if (!saved.some((r) => r.id === recipe.id)) {
    saved = [recipe, ...saved];
    listeners.forEach((l) => l());
  }
}

export function isRecipeSaved(id: string) {
  return saved.some((r) => r.id === id);
}

export function useSavedRecipes(): Recipe[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => saved,
    () => saved
  );
}
