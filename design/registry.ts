// Auto-assembled from design/studies/*.study.tsx — one import + one array entry per study.
import { AddGrocerySheetStudy } from "./studies/AddGrocerySheet.study";
import { AddRecipeSheetStudy } from "./studies/AddRecipeSheet.study";
import { AddToGroceriesSheetStudy } from "./studies/AddToGroceriesSheet.study";
import { AddToPlanSheetStudy } from "./studies/AddToPlanSheet.study";
import { BackdropStudy } from "./studies/Backdrop.study";
import { ButtonsStudy } from "./studies/Buttons.study";
import { CookbookPickerSheetStudy } from "./studies/CookbookPickerSheet.study";
import { CookingLoaderTextStudy } from "./studies/CookingLoaderText.study";
import { FeedbackStudy } from "./studies/Feedback.study";
import { FormControlsStudy } from "./studies/FormControls.study";
import { GrainStudy } from "./studies/Grain.study";
import { ImportDemoCardStudy } from "./studies/ImportDemoCard.study";
import { IngredientFilterSheetStudy } from "./studies/IngredientFilterSheet.study";
import { LoadingScreenStudy } from "./studies/LoadingScreen.study";
import { LogoStudy } from "./studies/Logo.study";
import { MealAddRecipeSheetStudy } from "./studies/MealAddRecipeSheet.study";
import { MealMenuStudy } from "./studies/MealMenu.study";
import { MealPlanIntakeStudy } from "./studies/MealPlanIntake.study";
import { NewCookbookSheetStudy } from "./studies/NewCookbookSheet.study";
import { OnboardingChecklistStudy } from "./studies/OnboardingChecklist.study";
import { OnboardingScreenStudy } from "./studies/OnboardingScreen.study";
import { OptionRowStudy } from "./studies/OptionRow.study";
import { ProgressHeaderStudy } from "./studies/ProgressHeader.study";
import { RecipeCardStudy } from "./studies/RecipeCard.study";
import { StepTextStudy } from "./studies/StepText.study";
import { SwipeDeckStudy } from "./studies/SwipeDeck.study";
import { SwipeSettingsStudy } from "./studies/SwipeSettings.study";
import { ToastStudy } from "./studies/Toast.study";
import { TotalTimeSheetStudy } from "./studies/TotalTimeSheet.study";
import { TypographyStudy } from "./studies/Typography.study";
import { findRegistryProblems } from "./integrity.ts";
import type { Study } from "./types.ts";

/** The canonical list of Design Studio components. Append one line per study. */
export const studies: Study[] = [
  AddGrocerySheetStudy,
  AddRecipeSheetStudy,
  AddToGroceriesSheetStudy,
  AddToPlanSheetStudy,
  BackdropStudy,
  ButtonsStudy,
  CookbookPickerSheetStudy,
  CookingLoaderTextStudy,
  FeedbackStudy,
  FormControlsStudy,
  GrainStudy,
  ImportDemoCardStudy,
  IngredientFilterSheetStudy,
  LoadingScreenStudy,
  LogoStudy,
  MealAddRecipeSheetStudy,
  MealMenuStudy,
  MealPlanIntakeStudy,
  NewCookbookSheetStudy,
  OnboardingChecklistStudy,
  OnboardingScreenStudy,
  OptionRowStudy,
  ProgressHeaderStudy,
  RecipeCardStudy,
  StepTextStudy,
  SwipeDeckStudy,
  SwipeSettingsStudy,
  ToastStudy,
  TotalTimeSheetStudy,
  TypographyStudy,
];

if (__DEV__) {
  const problems = findRegistryProblems(studies);
  if (problems.length) {
    throw new Error(`Design Studio registry is invalid:\n- ${problems.join("\n- ")}`);
  }
}
