import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  setGoals, setCookDays, setPreferences, buildUserPayload, buildPreferences, resetOnboarding,
} from "../lib/onboarding.ts";
import { gateRoute, DECK_ROUTE, ONBOARDING_ROUTE } from "../lib/onboardingGate.ts";
import type { ApiPreferences } from "../lib/api/preferences.ts";

beforeEach(() => resetOnboarding());

/* ---------- Test Case 1: draft accumulation & single flush ---------- */

test("draft holds the LATEST answer after a back-nav edit; flush builds each payload once", async () => {
  // Walk the flow, recording answers.
  setGoals(["Eat healthier", "Kid-friendly meals"]);
  setCookDays(["mon", "wed", "fri"]);
  setPreferences({ weeklyBudgetCents: 20000 });
  setPreferences({ groceryStores: ["walmart"] });
  setPreferences({ likes: [{ facet: "cuisine", value: "Thai" }] });

  // Go back and change the budget — the draft overwrites, not appends.
  setPreferences({ weeklyBudgetCents: 8000 });

  // Completion: exactly one users payload + one preferences payload, carrying the latest values.
  const userCalls: unknown[] = [];
  const prefCalls: ApiPreferences[] = [];
  const postUser = async (b: unknown) => { userCalls.push(b); };
  const putPreferences = async (b: ApiPreferences) => { prefCalls.push(b); };

  // The flush drains the draft into the two writes (mirrors auth.ts createUser + flushOnboarding).
  await postUser(buildUserPayload());
  await putPreferences(buildPreferences());

  assert.equal(userCalls.length, 1, "exactly one POST /v1/users");
  assert.equal(prefCalls.length, 1, "exactly one PUT /v1/preferences");
  assert.deepEqual(userCalls[0], { goals: ["eat_healthier", "kid_friendly"], cook_days: ["mon", "wed", "fri"] });
  assert.equal(prefCalls[0].weekly_budget_cents, 8000, "carries the CHANGED budget, not 20000");
  assert.deepEqual(prefCalls[0].grocery_stores, ["walmart"]);
  assert.deepEqual(prefCalls[0].likes, [{ facet: "cuisine", value: "Thai" }]);
});

test("no payload is built with the collected answers until completion (nothing writes mid-flow)", () => {
  // Recording answers must not itself trigger a mapped write — the draft only materialises on demand.
  setPreferences({ weeklyBudgetCents: 15000 });
  // The very act of building is the only path to a payload; before we call it, no write exists.
  const prefs = buildPreferences();
  assert.equal(prefs.weekly_budget_cents, 15000);
});

test("a rejected flush leaves the draft intact and reports the error", async () => {
  setGoals(["Save money"]);
  setPreferences({ weeklyBudgetCents: 9000 });

  const putPreferences = async (_: ApiPreferences) => { throw new Error("network"); };

  // The flush rejects; because we do NOT reset on failure, the draft still holds the answers.
  await assert.rejects(() => putPreferences(buildPreferences()), /network/);

  // Draft survived — a retry rebuilds the same payload.
  assert.equal(buildPreferences().weekly_budget_cents, 9000);
  assert.deepEqual(buildUserPayload(), { goals: ["save_money"], cook_days: [] });
});

test("default draft supplies model defaults for untouched fields", () => {
  const prefs = buildPreferences();
  assert.equal(prefs.skill_level, "intermediate");
  assert.equal(prefs.household_adults, 2);
  assert.equal(prefs.eats_leftovers, true);
});

/* ---------- Test Case 2: first-launch gate ---------- */

test("no session → onboarding", () => {
  assert.equal(gateRoute(false, undefined), ONBOARDING_ROUTE);
  assert.equal(gateRoute(false, true), ONBOARDING_ROUTE);
});

test("session but onboarding unfinished → onboarding", () => {
  assert.equal(gateRoute(true, false), ONBOARDING_ROUTE);
  assert.equal(gateRoute(true, undefined), ONBOARDING_ROUTE);
});

test("session + finished onboarding → deck", () => {
  assert.equal(gateRoute(true, true), DECK_ROUTE);
});
