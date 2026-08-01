import { Redirect } from "expo-router";

// Entry point → start the onboarding flow at the welcome screen.
export default function Index() {
  return <Redirect href="/(onboarding)/welcome" />;
}
