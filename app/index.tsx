import React from "react";
import { Redirect } from "expo-router";
import { LoadingScreen } from "../components/recime/LoadingScreen";
import { getSession } from "../lib/api/session";
import { getMe } from "../lib/api/me";
import { gateRoute, type GateRoute } from "../lib/onboardingGate";

// First-launch gate: a returning, onboarded user goes straight to the deck; a new or
// unonboarded user enters onboarding. The account is provisioned at the end of onboarding,
// so a missing session always means onboarding (the decision itself lives in onboardingGate).
export default function Index() {
  const [route, setRoute] = React.useState<GateRoute | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const session = await getSession().catch(() => null);
      // Only ask the server about onboarding when there's a session to authenticate the call.
      const finished = session ? await getMe().then((m) => m.finished_onboarding).catch(() => false) : false;
      if (!cancelled) setRoute(gateRoute(!!session, finished));
    })();
    return () => { cancelled = true; };
  }, []);

  if (!route) return <LoadingScreen />;
  return <Redirect href={route} />;
}
