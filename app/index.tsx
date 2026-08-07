import { Redirect } from "expo-router";

// Entry point → start the onboarding flow at the welcome screen.
// TEMP (manual verification): routed straight to Recipes so you can test the import
// fixes without walking onboarding. Ask me to revert to "/(onboarding)/welcome" before ship.
export default function Index() {
  return <Redirect href="/(app)/recipes" />;
}
