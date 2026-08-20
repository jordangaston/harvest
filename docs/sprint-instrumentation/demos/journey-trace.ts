// Live exercise: replays a real user journey through the actual analytics core (the same object the
// app's chokepoints call) with a capturing backend, and prints the resulting event stream. Run:
//   node --test-reporter=spec docs/sprint-instrumentation/demos/journey-trace.ts   (or plain `node <file>`)
import { Analytics } from "../../../lib/analytics/core.ts";
import type { Backend, Props } from "../../../lib/analytics/backend.ts";

const stream: string[] = [];
const capture: Backend = {
  track: (event: string, props?: Props) => stream.push(`track      ${event}  ${JSON.stringify(props)}`),
  identify: (userId: string) => stream.push(`identify   ${userId}`),
  setPeople: (props: Props) => stream.push(`people.set ${JSON.stringify(props)}`),
  reset: () => stream.push(`reset`),
};

const analytics = new Analytics({ now: () => "2026-08-07T00:00:00.000Z" });
analytics.setBackend(capture);

// A user moves through onboarding, taps CTAs, signs up, then imports + saves a recipe.
analytics.setScreen("/(onboarding)/welcome"); // S3 Screen Viewed
analytics.track("Button Tapped", { label: "Get started" }); // S4
analytics.setScreen("/(onboarding)/flow"); // S3
analytics.track("Button Tapped", { label: "Continue" }); // S4 (the CTA)
analytics.track("Onboarding Step Completed", { step: "/(onboarding)/flow" }); // S5
analytics.setScreen("/(onboarding)/phone");
analytics.onSignup("user-42", { goals: ["eat_healthier"], cook_days: ["mon", "wed"] }); // S2
analytics.setScreen("/(app)/recipes"); // S3
analytics.track("Recipe Imported", { recipe_count: 1 }); // S6
analytics.track("Recipe Saved", { recipe_id: "r1", cookbook_count: 2 }); // S6
analytics.track("Cookbook Created", { cookbook_id: "c9" }); // S6

console.log(stream.join("\n"));
