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
};

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
