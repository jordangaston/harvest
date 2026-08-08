import { Redirect } from "expo-router";

// Entry point → start the onboarding flow at the welcome screen. Onboarding
// collects the user's answers and the account is provisioned at the end
// (setting-up), so the signup POST carries the onboarding payload (C2).
export default function Index() {
  return <Redirect href="/(onboarding)/welcome" />;
}
